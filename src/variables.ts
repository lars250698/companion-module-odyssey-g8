import type { ModuleInstance } from './main.js'

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions([{ variableId: 'volume', name: 'Audio Volume' }])
}
