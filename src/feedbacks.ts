import { combineRgb, SomeCompanionFeedbackInputField } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { CapabilityStatus } from '@smartthings/core-sdk'
import { refresh } from './helpers.js'

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
			callback: async (feedback) => {
				const deviceId = feedback.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const status: CapabilityStatus = await self.smartThingsClient.devices.getCapabilityStatus(
					deviceId,
					'main',
					'switch',
				)
				return status?.['switch']?.['value'] === 'on'
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
			callback: async (feedback) => {
				const deviceId = feedback.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const input = feedback.options.input
				if (!input || typeof input !== 'string') {
					throw new Error()
				}
				const status: CapabilityStatus = await self.smartThingsClient.devices.getCapabilityStatus(
					deviceId,
					'main',
					'samsungvd.mediaInputSource',
				)
				const inputSourceMap: Array<{ id: string; name: string }> =
					(status?.['supportedInputSourcesMap']?.['value'] as Array<{ id: string; name: string }>) ?? []
				if (!inputSourceMap) return false

				const inputSourceName = inputSourceMap.find(
					(inputSource) => inputSource.id === input || inputSource.name === input,
				)
				if (!inputSourceName) return false

				const selectedInput = status?.['inputSource'] ?? {}
				if (!selectedInput) return false
				return selectedInput.value === inputSourceName.id
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
			callback: async (feedback) => {
				const deviceId = feedback.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				await refresh(self, deviceId)
				const status: CapabilityStatus = await self.smartThingsClient.devices.getCapabilityStatus(
					deviceId,
					'main',
					'audioMute',
				)
				return status?.['mute']?.['value'] === 'muted'
			},
		},
		AudioVolume: {
			name: 'Audio Volume',
			type: 'advanced',
			options: [deviceIdDropdownOption],
			callback: async (feedback) => {
				const deviceId = feedback.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				await refresh(self, deviceId)
				const status: CapabilityStatus = await self.smartThingsClient.devices.getCapabilityStatus(
					deviceId,
					'main',
					'audioVolume',
				)
				const volume = status?.volume?.value as string
				const unit = status?.volume?.unit as string
				self.setVariableValues({ volume: volume })
				return { text: volume + unit }
			},
		},
	})
}
