const { getVersion, getDictionaryAddress } = require('./header');
const { read16 } = require('./rw16');
const decodeText = require('./decodeText');

module.exports = function decodeDictionaryTable(state) {
	let address = getDictionaryAddress(state);

	const dictionary = {};

	const wordSeparatorCount = state.memory[address++];
	let wordSeparators = '';
	for (let i = 0; i < wordSeparatorCount; ++i) {
		wordSeparators += String.fromCharCode(state.memory[address++]);
	}

	const entryLength = state.memory[address++];
	const entryCount = read16(state.memory, address);
	address += 2;

	const entries = [];
	const textLength = getVersion(state) <= 3 ? 6 : 9;
	const encodedTextLength = getVersion(state) <= 3 ? 4 : 6;
	const dataLength = entryLength - encodedTextLength;
	for (let i = 0; i < entryCount; ++i) {
		const encodedText = state.memory.slice(address, address + encodedTextLength);
		const data = state.memory.slice(address + encodedTextLength, address + encodedTextLength + dataLength);
		entries.push({ number: i, encodedText, data, address });
		address += encodedTextLength + dataLength;
	}

	return {
		wordSeparators,
		entries,
		textLength,
		encodedTextLength,
		dataLength
	};
}
