const getAlphabets = require('./getAlphabets');
const { getVersion, getAbbreviationsTableAddress, getAlphabetTableAddress } = require('./header');
const { read16 } = require('./rw16');

module.exports = function decodeText(state, address, isAbbreviation = false) {
	const version = getVersion(state);
	const alphabets = getAlphabets(state);

	let text = '';
	let alphabet = 0;
	let shift = null;
	let abbr = null;
	let tenbit = null;

	for (;;) {
		const encoded = read16(state.memory, address);
		address += 2;

		// console.log('0x' + encoded.toString(16).padStart(4, '0') + '  0b' + encoded.toString(2).padStart(16, '0'));

		const zchars = [
			(encoded >> 10) & 0x1F,
			(encoded >> 5) & 0x1F,
			(encoded >> 0) & 0x1F
		];

		zchars.forEach(c => {
			if (abbr != null) {
				const abbreviationAddress = 2 * read16(state.memory, getAbbreviationsTableAddress(state) + 2 * (abbr + c));
				text += decodeText(state, abbreviationAddress, true).text;
				abbr = null;
			} else if (tenbit != null) {
				if (tenbit === -1) {
					tenbit = c;
				} else {
					text += String.fromCharCode(tenbit << 5 | c);
					tenbit = null;
				}
			} else if (c === 0) {
				text += ' ';
			} else if (c === 1 && version === 1) {
				text += '\n';
			} else if (
				(c === 1 && version === 2) ||
				(c >= 1 && c <= 3 && version >= 3)
			) {
				if (isAbbreviation) {
					throw new Error('abbreviation used from inside abbreviation');
				}
				abbr = 32*(c-1);
			} else if (c === 2 && version <= 2) {
				shift = (alphabet + 1) % 3;
			} else if (c === 3 && version <= 2) {
				shift = (alphabet + 2) % 3;
			} else if (c === 4 && version <= 2) {
				alphabet = (alphabet + 1) % 3;
			} else if (c === 5 && version <= 2) {
				alphabet = (alphabet + 2) % 3;
			} else if (c === 4 && version >= 3) {
				shift = 1;
			} else if (c === 5 && version >= 3) {
				shift = 2;
			} else if (c >= 6) {
				const a = shift != null ? shift : alphabet;
				shift = null;

				if (a === 2 && c === 6) {
					tenbit = -1;
				} else if (version <= 4 || getAlphabetTableAddress(state) === 0) {
					const char = alphabets[a][c-6];
					text += char;
				} else {
					const index = 26 * a + (c - 6);
					text += String.fromCharCode(state.memory[getAlphabetTableAddress(state) + index]);
				}
			}
		});

		if (encoded & 0x8000) {
			break;
		}
	}

	return { text, nextAddress: address };
}
