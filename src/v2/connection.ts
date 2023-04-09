import { InputValue, InstanceStatus } from '@companion-module/base'
import { OnTimeInstance } from '..'
import Websocket from 'ws'
import { mstoTime, toReadableTime } from '../utilities'
import axios from 'axios'
import { feedbackId, variableId } from '../enums'

let ws: Websocket | null = null
let reconnectionTimeout: NodeJS.Timeout | null = null
const reconnectInterval = 1000
let shouldReconnect = true

export function connect(self: OnTimeInstance): void {
	const host = self.config.host
	const port = self.config.port

	if (!host || !port) {
		self.updateStatus(InstanceStatus.BadConfig, `no host and/or port defined`)
		return
	}

	self.updateStatus(InstanceStatus.Connecting)

	if (ws) {
		ws.close()
	}

	const pattern = /^((http|https):\/\/)/

	if (pattern.test(host)) {
		host.replace(pattern, '')
	}

	ws = new Websocket(`ws://${host}:${port}/ws`)

	ws.onopen = () => {
		clearTimeout(reconnectionTimeout as NodeJS.Timeout)
		self.updateStatus(InstanceStatus.Ok)
		self.log('debug', 'Socket connected')
	}

	ws.onclose = (code) => {
		self.log('debug', `Connection closed with code ${code}`)
		self.updateStatus(InstanceStatus.Disconnected, `Connection closed with code ${code}`)
		if (shouldReconnect) {
			reconnectionTimeout = setTimeout(() => {
				if (ws && ws.readyState === Websocket.CLOSED) {
					connect(self)
				}
			}, reconnectInterval)
		}
	}

	ws.onerror = (data) => {
		self.log('debug', `WebSocket error: ${data}`)
	}

	ws.onmessage = (event: any) => {
		try {
			const data = JSON.parse(event.data)

			// console.log(event.data)

			const { type, payload } = data

			if (!type) {
				return
			}

			if (type === 'ontime') {
				self.states = payload

				// console.log(self.states)

				const timer = toReadableTime(self.states.timer.current)
				const clock = toReadableTime(self.states.timer.clock)
				const timer_start = toReadableTime(self.states.timer.startedAt)
				const timer_finish = toReadableTime(self.states.timer.expectedFinish)
				const delay = mstoTime(self.states.timer.addedTime)
				self.states.isNegative = self.states.timer.current < 0

				self.setVariableValues({
					[variableId.Time]: timer.hours + ':' + timer.minutes + ':' + timer.seconds,
					[variableId.TimeHM]: timer.hours + ':' + timer.minutes,
					[variableId.TimeH]: timer.hours,
					[variableId.TimeM]: timer.minutes,
					[variableId.TimeS]: timer.seconds,
					[variableId.Clock]: clock.hours + ':' + clock.minutes + ':' + clock.seconds,
					[variableId.TimerStart]: timer_start.hours + ':' + timer_start.minutes + ':' + timer_start.seconds,
					[variableId.TimerFinish]: timer_finish.hours + ':' + timer_finish.minutes + ':' + timer_finish.seconds,
					[variableId.TimerDelay]: delay,

					[variableId.PlayState]: self.states.playback,
					[variableId.OnAir]: self.states.onAir,

					[variableId.TitleNow]: self.states.titles.titleNow,
					[variableId.SubtitleNow]: self.states.titles.subtitleNow,
					[variableId.SpeakerNow]: self.states.titles.presenterNow,
					[variableId.NoteNow]: self.states.titles.noteNow,
					[variableId.TitleNext]: self.states.titles.titleNext,
					[variableId.SubtitleNext]: self.states.titles.subtitleNext,
					[variableId.SpeakerNext]: self.states.titles.presenterNext,
					[variableId.NoteNext]: self.states.titles.noteNext,

					[variableId.SpeakerMessage]: self.states.timerMessage.text,
					[variableId.PublicMessage]: self.states.publicMessage.text,
					[variableId.LowerMessage]: self.states.lowerMessage.text,
				})
				self.checkFeedbacks(
					feedbackId.ColorRunning,
					feedbackId.ColorPaused,
					feedbackId.ColorStopped,
					feedbackId.ColorRoll,
					feedbackId.ColorNegative,
					feedbackId.OnAir,
					feedbackId.SpeakerMessageVisible,
					feedbackId.PublicMessageVisible,
					feedbackId.LowerMessageVisible
				)
			}

			if (type === 'ontime-refetch') {
				self.log('debug', 'refetching events')
				self.events = []
				initEvents(self).then(
					() => {
						self.init_actions()
					},
					(e: any) => {
						self.log('debug', e)
					}
				)
			}
		} catch (_) {
			// ignore unhandled
		}
	}
}

export function disconnectSocket(): void {
	shouldReconnect = false
	if (reconnectionTimeout) {
		clearTimeout(reconnectionTimeout)
	}
	ws?.close()
}

export function socketSend(message: string): void {
	if (ws && ws.readyState === ws.OPEN) {
		ws.send(message)
	}
}

export function socketSendJson(type: string, payload?: InputValue): void {
	socketSend(
		JSON.stringify({
			type,
			payload,
		})
	)
}

export async function initEvents(self: OnTimeInstance): Promise<void> {
	self.log('debug', 'fetching events from ontime')
	try {
		const res = await axios.get(`http://${self.config.host}:${self.config.port}/events`, { responseType: 'json' })
		self.log('debug', `fetched ${res.data.length} events`)
		self.events = res.data.map((evt: any) => ({
			id: evt.id,
			label: evt.title,
		}))
	} catch (e: any) {
		self.log('error', 'failed to fetch events from ontime')
		self.log('error', e)
	}
}