const { getGlobalTableAddress } = require('./header');
const { read16, write16 } = require('./rw16');

function variableLoad(state, variable) {
	if (variable === 0) {
		const frame = state.stack[state.stack.length - 1];
		if (frame.stack.length < 1) {
			throw new Error('stack underflow');
		}
		return frame.stack.pop();
	} else if (variable <= 0x0F) {
		const frame = state.stack[state.stack.length - 1];
		return frame.localVariables[variable - 1];
	} else {
		return read16(state.memory, getGlobalTableAddress(state) + 2 * (variable - 0x10));
	}
}

function variableStore(state, variable, value) {
	if (variable === 0) {
		const frame = state.stack[state.stack.length - 1];
		frame.stack.push(value);
	} else if (variable <= 0x0F) {
		const frame = state.stack[state.stack.length - 1];
		frame.localVariables[variable - 1] = value;
	} else {
		write16(state.memory, getGlobalTableAddress(state) + 2 * (variable - 0x10), value);
	}
}

module.exports = {
	variableLoad,
	variableStore,
};
