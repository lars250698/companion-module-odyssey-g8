import type { ModuleInstance } from './main.js'
import { type CompanionVariableDefinition } from '@companion-module/base'

const DEVICE_VARIABLE_FIELDS = [
	{ key: 'power', label: 'Power' },
	{ key: 'input', label: 'Selected Input' },
	{ key: 'mute', label: 'Mute State' },
	{ key: 'volume', label: 'Volume' },
]

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinition[] = []
	for (const device of self.devices) {
		const baseId = self.getDeviceVariableBaseId(device.deviceId)
		const friendlyName = self.getDeviceDisplayName(device.deviceId)
		for (const field of DEVICE_VARIABLE_FIELDS) {
			definitions.push({
				variableId: `${baseId}_${field.key}`,
				name: `${friendlyName} ${field.label}`,
			})
		}
	}
	self.setVariableDefinitions(definitions)
}
