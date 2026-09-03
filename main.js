const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

class MXN5Instance extends InstanceBase {

	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config
		this.state = {}
		this.receivebuffer = ''
		this.channelcount = 4

		this.updateStatus(InstanceStatus.Ok)

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions

		this.connect()
	}

	connect() {
		let self = this
		if (!this.config.host || !this.config.port) {
			this.updateStatus(InstanceStatus.BadConfig)
			this.log('warn', 'Uncomplete host or port in connection configuration')
			return
		}

		this.disconnect()
		this.updateStatus(InstanceStatus.Connecting)
		this.log('debug', 'trying to connect to ' + this.config.host + ':' + this.config.port)

		this.socket = new TCPHelper(this.config.host, this.config.port)

		this.socket.on('status_change', (status, message) => {
			self.updateStatus(status, message)
		})

		this.socket.on('error', (err) => {
			self.log('debug', "Network error: " + err.message)
		})

		this.socket.on('connect', () => {
			self.log('debug', "Connected")
			self.sendCmd('< GET 0 ALL >');
			//self.updateActions(); // export actions
		})

		// separate buffered stream into lines with responses
		this.socket.on('data', (chunk) => {
			let i = 0, line = '', offset = 0
			// self.log('debug', 'Receive chunk: '+ chunk)
			self.receivebuffer += chunk

			if (self.receivebuffer.length > 128_000) {
				self.receivebuffer = ''
				self.log('error', 'Receive buffer overflow. Flushing.')
				return
			}

			let start = self.receivebuffer.indexOf('<')
			let end = self.receivebuffer.indexOf('>')

			if (start == -1) return // no valid reply has been started
			if (end == -1) return // no valid reply has been ended
			if (end < start) { // there is a fragment at start of buffer
				self.receivebuffer = self.receivebuffer.slice(start) // remove fragment
			}

			while ( (i = self.receivebuffer.indexOf('>')) !== -1) {
				line = self.receivebuffer.substring(1, i - 1)
				self.receivebuffer = self.receivebuffer.slice(i+1)
				self.socket.emit('receiveline', line.toString())
			}

		})

		this.socket.on('receiveline', (line) => {
			self.processShureCommand(line.trim())
		})

	}

	disconnect() {
		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}
	}

	processShureCommand(command) {
		let self = this
		
		this.updateVariable('last_command_received', command)
		
		let commandArr = null
		let commandNum = null
		let commandVar = null
		let commandVal = null
	
		try {
			if (command.substring(0, 3) === 'REP') {
				//this is a report command
				let channelNumber = parseInt(command.substr(4,2))
				let match = ''
				
				commandArr = command.split(' ')			
				if (isNaN(channelNumber)) {
					//this command isn't about a specific channel

					try {
						[match, commandVar, commandVal] = command.match(/^REP ([A-Z_]+) (.+)$/)
					} catch (error) {
						return
					}
				}
				else {
					//this command IS about a specific channel
					try {
						[match, commandNum, commandVar, commandVal] = command.match(/^REP (\d+) ([A-Z_]+) (.+)$/)
					} catch (error) {
						return
					}
				}
				
				switch(commandVar) {
					case 'MODEL':
						self.updateVariable('model', this.trimShureString(commandVal));
						break;
					case 'SERIAL_NUM':
						self.updateVariable('serial_number', this.trimShureString(commandVal));
						break;
					case 'FW_VER':
						self.updateVariable('firmware_version', this.trimShureString(commandVal));
						break;
					case 'IP_ADDR_NET_AUDIO_PRIMARY':
						self.updateVariable('ipaddress_audio_primary', this.trimShureString(commandVal));
						break;
					case 'IP_SUBNET_NET_AUDIO_PRIMARY':
						self.updateVariable('subnet_audio_primary', this.trimShureString(commandVal));
						break;
					case 'IP_GATEWAY_NET_AUDIO_PRIMARY':
						self.updateVariable('gateway_audio_primary', this.trimShureString(commandVal));
						break;
					case 'CONTROL_MAC_ADDR':
						self.updateVariable('mac_address', this.trimShureString(commandVal));
						break;
					case 'DEVICE_ID':
						self.updateVariable('deviceid', this.trimShureString(commandVal));
						break;
					case 'NA_DEVICE_ID':
						self.updateVariable('na_deviceid', this.trimShureString(commandVal));
						break;
					case 'CHAN_NAME':
						self.updateVariable(`channel_name_${commandNum}`, this.trimShureString(commandVal));
						self.updateActions();
						self.updateFeedbacks();
						break;
					case 'NA_CHAN_NAME':
						self.updateVariable(`na_channel_name_${commandNum}`, this.trimShureString(commandVal));
						self.updateActions();
						self.updateFeedbacks();
						break;
					case 'FLASH':
						self.updateVariable('flash_state', this.trimShureString(commandVal));
						self.checkFeedbacks('flash_state');
						break;
					case 'AUDIO_OUT_CLIP_INDICATOR':
						self.updateVariable('clip_indicator', this.trimShureString(commandVal));
						self.checkFeedbacks('clip_indicator');
						break;
					case 'METER_RATE':
						self.updateVariable('meter_rate', this.trimShureString(commandVal));
						break;
					case 'AUDIO_GAIN_HI_RES':
						if (commandNum) {
							const channel = parseInt(commandNum, 10)
							self.updateVariable(`channel_audio_gain_${channel}`, this.gainStringToNumber(this.trimShureString(commandVal)))
						} else {
							self.updateVariable('audio_gain_hi_res', this.gainStringToNumber(this.trimShureString(commandVal)))
						}
						break;
					case 'DEVICE_AUDIO_MUTE':
						self.updateVariable('device_audio_mute', this.trimShureString(commandVal));
						self.checkFeedbacks('device_audio_mute');
						break;
					case 'AUDIO_MUTE':
						self.updateVariable(`channel_mute_${commandNum}`, this.trimShureString(commandVal));
						self.checkFeedbacks('channel_mute');
						break;
					case 'PRESET':
						self.updateVariable('preset_active', this.trimShureString(commandVal));
						break;
					case 'PRESET_NAME':
						self.updateVariable(`preset_name_${commandNum}`, this.trimShureString(commandVal));
						break;
					case 'LIMITER_ENGAGED':
						self.updateVariable('limiter_engaged', this.trimShureString(commandVal));
						self.checkFeedbacks('limiter_engaged');
						break;
					case 'ENCRYPTION':
						self.updateVariable('encryption', this.trimShureString(commandVal));
						break;
					case 'LAST_ERROR_EVENT':
						self.updateVariable('last_error', this.trimShureString(commandVal));
						break;
					case 'PEQ':
						self.updateVariable(`peq_filter_${commandNum}`, this.trimShureString(commandVal));
						break;
					case 'DELAY':
						self.updateVariable(`delay_${commandNum}`, this.trimShureString(commandVal));
						break;
					case 'BYPASS_DSP':
						self.updateVariable('bypass_dsp', this.trimShureString(commandVal));
						break;
					case 'SIG_GEN_TYPE':
						self.updateVariable(`sig_gen_type_${commandNum}`, this.trimShureString(commandVal));
						break;
					case 'SIG_GEN_FREQ':
						self.updateVariable(`sig_gen_freq_${commandNum}`, this.trimShureString(commandVal));
						break;
					case 'SIG_GEN_GAIN':
						self.updateVariable(`sig_gen_gain_${commandNum}`, this.gainStringToNumber(this.trimShureString(commandVal)));
						break;
					case 'SIG_GEN':
						self.updateVariable(`sig_gen_status_${commandNum}`, this.trimShureString(commandVal));
						break;
					default:
						//self.log('debug', 'Unhandeled message from device: ' + command)
						break;
				}
			}
		}
		catch(error) {
			self.log('error', `Unexpected error processing message "${command}" from device:\n${error.trace}`)
		}
	}

	// When module gets deleted
	async destroy() {
		this.disconnect()
		this.log('debug', 'destroy')
	}

	async configUpdated(config) {
		let oldconfig = this.config
		this.config = config
		if (config.host !== oldconfig.host || config.port !== oldconfig.port) {
			this.disconnect()
			this.connect()
		}
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 8,
				regex: Regex.IP,
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Target Port',
				width: 4,
				default: '2202',
				regex: Regex.PORT,
			},
		]
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}

	//updateVariable: updates both the system instance variable and local variable for button display and feedback purposes
	updateVariable(variableName, value) {
		// this.log('debug', 'updating variable ' + variableName + ' to '+ value)
		if (typeof value === 'string' && value.match(/^\d+$/)) {value = parseInt(value)} 
		this.setVariableValues({[variableName]: value})
		this.state[variableName] = value
	}

	/**
	 * trims the strings returned by the api
	 * @param {string} string 
	 * @returns {string}
	 */
	trimShureString(string) {
		return string.replace(/^\{(.+?)\s*\}$/, "$1")
	}

	/**
	 * converts api highres gain string to a number
	 * @param {string} string 
	 * @returns {number}
	 */
	gainStringToNumber(string) {
		const highres = parseInt(string)
		if (isNaN(highres)) return 0
		return Math.round(highres - 1100) / 10
	}

	sendCmd(cmd) {
		if (!cmd) return

		if (this.socket && this.socket.isConnected) {
			try {
				this.socket.send(cmd)
			} catch (error) {
				this.updateStatus(InstanceStatus.ConnectionFailure)
				this.log('error', 'Sending command failed')
			}
			this.updateVariable('last_command_sent', cmd)
		} else {
			this.updateStatus(InstanceStatus.ConnectionFailure)
			this.log('error', 'Socket not connected')
		}
	}
}

runEntrypoint(MXN5Instance, UpgradeScripts)
