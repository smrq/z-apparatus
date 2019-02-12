const decodeDictionaryTable = require('./decodeDictionaryTable');
const encodeText = require('./encodeText');
const { write16 } = require('./rw16');
const { getVersion } = require('./header');

module.exports = function parseText(state, text, textBufferAddress, parseTableAddress) {
	let address = textBufferAddress;
	const maxInputLength = state.memory[address++] - (getVersion(state) <= 4 ? 1 : 0);
	text = text.slice(0, maxInputLength);

	if (getVersion(state) >= 5) {
		state.memory[address++] = text.length;
	}
	for (let i = 0; i < text.length; ++i) {
		state.memory[address++] = text.charCodeAt(i);
	}
	if (getVersion(state) <= 4) {
		state.memory[address++] = 0;
	}

	if (getVersion(state) <= 4 || parseTableAddress !== 0) {
		const dictionary = decodeDictionaryTable(state);
		const separatorRegex = new RegExp('([ ' + dictionary.wordSeparators.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '])');

		let position = getVersion(state) <= 4 ? 1 : 2;
		let words = text.split(separatorRegex);
		words = words.map(text => {
			const result = {
				text: text.slice(0, dictionary.textLength).padEnd(dictionary.textLength, '\0'),
				length: text.length,
				position
			};
			position += text.length;
			return result;
		});
		words = words.filter(word => /[^\0 ]/.test(word.text));
		words.forEach(word => {
			const encodedText = encodeText(state, word.text);
			if (encodedText) {
				word.entry = dictionary.entries.find(entry =>
					entry.encodedText.every((c, i) => c === encodedText[i]));
			}
		});

		address = parseTableAddress;
		const maxParsedWords = state.memory[address++];
		words = words.slice(0, maxParsedWords);

		state.memory[address++] = words.length;
		words.forEach(word => {
			if (word.entry) {
				write16(state.memory, address, word.entry.address);
				address += 2;
				// state.memory[address++] = word.entry.address & 0xFF;
			} else {
				state.memory[address++] = 0;
				state.memory[address++] = 0;
			}

			state.memory[address++] = word.length;
			state.memory[address++] = word.position;
		});
	}
}
