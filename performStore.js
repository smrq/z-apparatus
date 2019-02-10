const { getGlobalTableAddress } = require('./header');
const { write16 } = require('./rw16');

module.exports = function performStore(state, variable, value) {
	switch (variable.type) {
		case 'global': {
			write16(state.memory, getGlobalTableAddress(state) + 2 * variable.index, value);
		} break;

		case 'local': {
			const frame = state.stack[state.stack.length - 1];
			frame.localVariables[variable.index] = value;
		} break;

		case 'stack': {
			const frame = state.stack[state.stack.length - 1];
			frame.stack.push(value);
		} break;
	}
}
