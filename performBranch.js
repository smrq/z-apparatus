const performReturn = require('./performReturn');

module.exports = function performBranch(state, offset) {
	if (offset === 0) {
		performReturn(state, 0);
	} else if (offset === 1) {
		performReturn(state, 1);
	} else {
		state.pc = (state.pc + offset - 2) & 0xFFFF;
	}
}
