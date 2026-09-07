const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function loadInstanceClass() {
	const context = {
		console,
		require(request) {
			if (request === '@companion-module/base') {
				return {
					InstanceBase: class {},
					runEntrypoint: () => {},
					InstanceStatus: {},
					Regex: {},
					TCPHelper: class {},
				}
			}
			return () => {}
		},
	}
	context.globalThis = context
	const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
	vm.runInNewContext(`${source}\nglobalThis.MXN5Instance = MXN5Instance`, context)
	return context.MXN5Instance
}

test('stores a zero-padded high-resolution gain response in the defined channel variable', () => {
	const MXN5Instance = loadInstanceClass()
	const updates = []
	const instance = {
		updateVariable: (id, value) => updates.push({ id, value }),
		trimShureString: MXN5Instance.prototype.trimShureString,
		gainStringToNumber: MXN5Instance.prototype.gainStringToNumber,
	}

	MXN5Instance.prototype.processShureCommand.call(instance, 'REP 03 AUDIO_GAIN_HI_RES {1110}')

	assert.deepEqual(updates, [
		{ id: 'last_command_received', value: 'REP 03 AUDIO_GAIN_HI_RES {1110}' },
		{ id: 'channel_audio_gain_3', value: 1 },
	])
})
