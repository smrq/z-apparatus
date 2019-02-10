const { getGlobalTableAddress } = require('./header');
const { read16 } = require('./rw16');

module.exports = function performDereference(state, operand) {
	switch (operand.type) {
		case 'largeconstant':
		case 'smallconstant': {
			return operand.value;
		}

		case 'global': {
			return read16(state.memory, getGlobalTableAddress(state) + 2 * operand.index);
		}

		case 'local': {
			const frame = state.stack[state.stack.length - 1];
			return frame.localVariables[operand.index];
		}

		case 'stack': {
			const frame = state.stack[state.stack.length - 1];
			if (frame.stack.length < 1) {
				throw new Error('stack underflow');
			}
			return frame.stack.pop();
		}
	}
}
