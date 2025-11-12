import { SomeCompanionActionInputField } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { getInputsource } from './helpers.js'

export function UpdateActions(self: ModuleInstance): void {
	const deviceIdDropdownOption: SomeCompanionActionInputField = {
		id: 'deviceId',
		type: 'dropdown',
		label: 'Device',
		choices: self.devices.map((device) => ({
			id: device.deviceId,
			label: device.name ?? device.presentationId,
		})),
		default: self.devices[0]?.deviceId ?? '',
	}

	self.setActionDefinitions({
		select_input: {
			name: 'Select input',
			options: [
				deviceIdDropdownOption,
				{
					id: 'input',
					type: 'textinput',
					label: 'Input',
					default: 'HDMI',
				},
			],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const input = event.options.input
				if (!input || typeof input !== 'string') {
					throw new Error()
				}
				const deviceState = await self.getDeviceStateSnapshot(deviceId, true)
				const newInput = getInputsource(input, deviceState)
				if (!newInput) {
					throw new Error(`Input ${input} not found`)
				}
				const client = self.getSmartThingsClient()
				await client.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'samsungvd.mediaInputSource',
					command: 'setInputSource',
					arguments: [newInput.id],
				})
				self.optimisticSetAttribute(deviceId, 'main', 'samsungvd.mediaInputSource', 'inputSource', newInput.id)
			},
		},
		powerToggle: {
			name: 'Toggle Power',
			options: [deviceIdDropdownOption],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const client = self.getSmartThingsClient()
				const deviceState = await self.getDeviceStateSnapshot(deviceId, true)
				let isCurrentlyOn: boolean | undefined
				if (deviceState) {
					const switchState = deviceState.components?.['main']?.['switch']?.['switch']?.['value']
					isCurrentlyOn = switchState === 'on'
				} else {
					const fallback = await client.devices.getStatus(deviceId)
					isCurrentlyOn = fallback.components?.['main']?.['switch']?.['switch']?.['value'] === 'on'
				}
				const command = isCurrentlyOn === true ? 'off' : 'on'
				await client.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'switch',
					command: command,
				})
				self.optimisticSetAttribute(deviceId, 'main', 'switch', 'switch', command)
				self.optimisticSetAttribute(deviceId, 'main', 'audioMute', 'mute', command === 'off' ? 'muted' : 'unmuted')
			},
		},
		power: {
			name: 'Set Power',
			options: [
				deviceIdDropdownOption,
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					choices: [
						{
							id: 'on',
							label: 'on',
						},
						{
							id: 'off',
							label: 'off',
						},
					],
					default: 'on',
				},
			],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const state = event.options.state
				if (!state || typeof state !== 'string') {
					throw new Error()
				}
				const client = self.getSmartThingsClient()
				await client.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'switch',
					command: state,
				})
				self.optimisticSetAttribute(deviceId, 'main', 'switch', 'switch', state)
				self.optimisticSetAttribute(deviceId, 'main', 'audioMute', 'mute', state === 'off' ? 'muted' : 'unmuted')
			},
		},
		volume: {
			name: 'Volume',
			options: [
				deviceIdDropdownOption,
				{
					id: 'action',
					type: 'dropdown',
					label: 'Action',
					choices: [
						{
							id: 'volumeUp',
							label: 'Volume up',
						},
						{
							id: 'volumeDown',
							label: 'Volume down',
						},
					],
					default: 'volumeUp',
				},
			],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const action = event.options.action
				if (!action || typeof action !== 'string') {
					throw new Error()
				}
				const deviceState = await self.getDeviceStateSnapshot(deviceId)
				const volumeStatus = deviceState?.components?.['main']?.['audioVolume']?.['volume']
				if (volumeStatus) {
					const delta = action === 'volumeUp' ? 1 : -1
					const currentValue = typeof volumeStatus.value === 'number' ? volumeStatus.value : Number(volumeStatus.value)
					if (!Number.isNaN(currentValue)) {
						const nextValue = Math.max(0, currentValue + delta)
						const extra = volumeStatus.unit ? { unit: volumeStatus.unit } : undefined
						self.optimisticSetAttribute(deviceId, 'main', 'audioVolume', 'volume', nextValue, extra)
					}
				}
				const client = self.getSmartThingsClient()
				await client.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'audioVolume',
					command: action,
				})
			},
		},
		muteToggle: {
			name: 'Toggle Mute',
			options: [deviceIdDropdownOption],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const client = self.getSmartThingsClient()
				const deviceState = await self.getDeviceStateSnapshot(deviceId, true)
				let isMute: boolean | undefined
				if (deviceState) {
					const muteValue = deviceState.components?.['main']?.['audioMute']?.['mute']?.['value']
					isMute = muteValue === 'muted'
				} else {
					const fallback = await client.devices.getStatus(deviceId)
					isMute = fallback.components?.['main']?.['audioMute']?.['mute']?.['value'] === 'muted'
				}
				const state = isMute === true ? 'unmuted' : 'muted'
				await client.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'audioMute',
					command: 'setMute',
					arguments: [state],
				})
				self.optimisticSetAttribute(deviceId, 'main', 'audioMute', 'mute', state)
			},
		},
		mute: {
			name: 'Mute',
			options: [
				deviceIdDropdownOption,
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					choices: [
						{
							id: 'muted',
							label: 'muted',
						},
						{
							id: 'unmuted',
							label: 'unmuted',
						},
					],
					default: 'muted',
				},
			],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const state = event.options.state
				if (!state || typeof state !== 'string') {
					throw new Error()
				}
				const client = self.getSmartThingsClient()
				await client.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'audioMute',
					command: 'setMute',
					arguments: [state],
				})
				self.optimisticSetAttribute(deviceId, 'main', 'audioMute', 'mute', state)
			},
		},
	})
}
