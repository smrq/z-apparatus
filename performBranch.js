const performReturn = require('./performReturn');

module.exports = function performBranch(state, offset) {
	if (offset === 0) {
		performReturn(state, 0);
	} else if (offset === 1) {
		performReturn(state, 1);
	} else {
		offset = new Int16Array([offset])[0];
		state.pc = state.pc + offset - 2;
	}
}
