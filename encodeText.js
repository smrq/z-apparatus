const { getVersion } = require('./header');
const getAlphabets = require('./getAlphabets');

module.exports = function encodeText(state, text) {
	const alphabets = getAlphabets(state);
	const version = getVersion(state);

	const zchars = [];
	const result = [];

	text.split('').forEach(char => {
		let index;
		if (char === ' ') {
			zchars.push(0);
		} else if ((index = alphabets[0].indexOf(char)) > -1) {
			zchars.push(6 + index);
		} else if ((index = alphabets[1].indexOf(char)) > -1) {
			zchars.push(version <= 2 ? 2 : 4);
			zchars.push(6 + index);
		} else if ((index = alphabets[2].indexOf(char)) > -1) {
			zchars.push(version <= 2 ? 3 : 5);
			zchars.push(6 + index);
		} else {
			throw new Error('could not text encode character ' + char);
		}
	});

	for (let i = 0; i < zchars.length; i += 3) {
		let value = (zchars[i] << 10) |
			((i + 1 < zchars.length ? zchars[i + 1] : 5) << 5) |
			((i + 2 < zchars.length ? zchars[i + 2] : 5) << 0) |
			((i + 3 < zchars.length ? 0 : (1 << 15)));
		result.push((value >> 8) & 0xFF);
		result.push((value >> 0) & 0xFF);
	}

	return result;
}
