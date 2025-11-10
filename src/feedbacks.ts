import { combineRgb, SomeCompanionFeedbackInputField } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { InputSourceMapEntry } from './types.js'

function requireDeviceId(value: unknown): string {
	if (!value || typeof value !== 'string') {
		throw new Error('Device is required')
	}
	return value
}

function requireText(value: unknown, field: string): string {
	if (!value || typeof value !== 'string') {
		throw new Error(`${field} is required`)
	}
	return value
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const deviceIdDropdownOption: SomeCompanionFeedbackInputField = {
		id: 'deviceId',
		type: 'dropdown',
		label: 'Device',
		choices: self.devices.map((device) => ({
			id: device.deviceId,
			label: device.name ?? device.presentationId,
		})),
		default: self.devices[0]?.deviceId ?? '',
	}

	self.setFeedbackDefinitions({
		PowerState: {
			name: 'Power State',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [deviceIdDropdownOption],
			subscribe: (feedback) => {
				const deviceId = feedback.options.deviceId
				if (typeof deviceId === 'string') {
					self.subscribeDeviceState(deviceId)
				}
			},
			unsubscribe: (feedback) => {
				const deviceId = feedback.options.deviceId
				if (typeof deviceId === 'string') {
					self.unsubscribeDeviceState(deviceId)
				}
			},
			callback: (feedback) => {
				const deviceId = requireDeviceId(feedback.options.deviceId)
				const status = self.getCachedDeviceState(deviceId)
				if (!status) {
					self.requestDeviceRefresh(deviceId)
					return false
				}
				const value = status.components?.['main']?.['switch']?.['switch']?.['value']
				return value === 'on'
			},
		},
		InputState: {
			name: 'Selected Input',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				deviceIdDropdownOption,
				{
					id: 'input',
					type: 'textinput',
					label: 'Input',
					default: 'HDMI',
				},
			],
			subscribe: (feedback) => {
				const deviceId = feedback.options.deviceId
				if (typeof deviceId === 'string') {
					self.subscribeDeviceState(deviceId)
				}
			},
			unsubscribe: (feedback) => {
				const deviceId = feedback.options.deviceId
				if (typeof deviceId === 'string') {
					self.unsubscribeDeviceState(deviceId)
				}
			},
			callback: (feedback) => {
				const deviceId = requireDeviceId(feedback.options.deviceId)
				const input = requireText(feedback.options.input, 'Input')
				const status = self.getCachedDeviceState(deviceId)
				if (!status) {
					self.requestDeviceRefresh(deviceId)
					return false
				}
				const capability = status.components?.['main']?.['samsungvd.mediaInputSource']
				console.log(capability)
				const inputSourceMap: InputSourceMapEntry[] =
					(capability?.['supportedInputSourcesMap']?.['value'] as InputSourceMapEntry[]) ?? []
				const match = inputSourceMap.find((entry) => entry.id === input || entry.name === input)
				if (!match) return false
				const selectedInput = capability?.['inputSource']?.['value']
				return selectedInput === match.id
			},
		},
		MuteState: {
			name: 'Mute',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [deviceIdDropdownOption],
			subscribe: (feedback) => {
				const deviceId = feedback.options.deviceId
				if (typeof deviceId === 'string') {
					self.subscribeDeviceState(deviceId)
				}
			},
			unsubscribe: (feedback) => {
				const deviceId = feedback.options.deviceId
				if (typeof deviceId === 'string') {
					self.unsubscribeDeviceState(deviceId)
				}
			},
			callback: (feedback) => {
				const deviceId = requireDeviceId(feedback.options.deviceId)
				const status = self.getCachedDeviceState(deviceId)
				if (!status) {
					self.requestDeviceRefresh(deviceId)
					return false
				}
				const muteValue = status.components?.['main']?.['audioMute']?.['mute']?.['value']
				return muteValue === 'muted'
			},
		},
		AudioVolume: {
			name: 'Audio Volume',
			type: 'advanced',
			options: [deviceIdDropdownOption],
			subscribe: (feedback) => {
				const deviceId = feedback.options.deviceId
				if (typeof deviceId === 'string') {
					self.subscribeDeviceState(deviceId)
				}
			},
			unsubscribe: (feedback) => {
				const deviceId = feedback.options.deviceId
				if (typeof deviceId === 'string') {
					self.unsubscribeDeviceState(deviceId)
				}
			},
			callback: (feedback) => {
				const deviceId = requireDeviceId(feedback.options.deviceId)
				const status = self.getCachedDeviceState(deviceId)
				if (!status) {
					self.requestDeviceRefresh(deviceId)
					return { text: '' }
				}
				const volume = status.components?.['main']?.['audioVolume']?.['volume']
				if (!volume || typeof volume.value === 'undefined') {
					return { text: '' }
				}
				const rawValue = volume.value
				if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
					return { text: '' }
				}
				const renderedValue = String(rawValue)
				self.setVariableValues({ volume: renderedValue })
				const unit = volume.unit ? String(volume.unit) : ''
				return { text: `${renderedValue}${unit}` }
			},
		},
	})
}
