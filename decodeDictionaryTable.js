const { getVersion, getDictionaryAddress } = require('./header');
const { read16 } = require('./rw16');

module.exports = function decodeDictionaryTable(state) {
	let address = header.dictionaryAddress;

	const dictionary = {};

	const wordSeparatorCount = state.memory[address++];
	const wordSeparators = [];
	for (let i = 0; i < wordSeparatorCount; ++i) {
		wordSeparators.push(state.memory[address++]);
	}

	const entryLength = state.memory[address++];
	const entryCount = read16(state.memory, address);
	address += 2;

	const entries = [];
	const encodedTextLength = getVersion(state) <= 3 ? 4 : 6;
	const dataLength = entryLength - encodedTextLength;
	for (let i = 0; i < entryCount; ++i) {
		const encodedText = state.memory.slice(address, encodedTextLength);
		address += encodedTextLength;
		const data = state.memory.slice(address, dataLength);
		address += dataLength;
		entries.push({ encodedText, data });
	}

	return {
		wordSeparators,
		entries,
		encodedTextLength,
		dataLength
	};
}
