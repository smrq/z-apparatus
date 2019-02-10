const { read16 } = require('./rw16');

function getVersion(state) {
	return state.memory[0];
}

function getDictionaryAddress(state) {
	return read16(state.memory, 0x08);
}

function getObjectTableAddress(state) {
	return read16(state.memory, 0x0A);
}

function getGlobalTableAddress(state) {
	return read16(state.memory, 0x0C);
}

function getAbbreviationsTableAddress(state) {
	return read16(state.memory, 0x18);
}

function getRoutinesOffset(state) {
	return read16(state.memory, 0x28);
}

function getStaticStringsOffset(state) {
	return read16(state.memory, 0x2A);
}

function getAlphabetTableAddress(state) {
	return read16(state.memory, 0x34);
}

module.exports = {
	getVersion,
	getDictionaryAddress,
	getObjectTableAddress,
	getGlobalTableAddress,
	getAbbreviationsTableAddress,
	getRoutinesOffset,
	getStaticStringsOffset,
	getAlphabetTableAddress
};

// function defineHeader(buffer) {
// 	function descriptor1(buffer, offset, bit) {
// 		const view = new DataView(buffer, offset, 1);
// 		return {
// 			enumerable: true,
// 			get() {
// 				return !!(view.getUint8(0) & (1 << bit));
// 			},
// 			set(value) {
// 				view.setUint8(0, value ?
// 					view.getUint8(0) | (1 << bit) :
// 					view.getUint8(0) & ~(1 << bit)
// 				);
// 			}
// 		}
// 	}
//
// 	function descriptor8(buffer, offset) {
// 		const view = new DataView(buffer, offset, 1);
// 		return {
// 			enumerable: true,
// 			get() { return view.getUint8(0); },
// 			set(value) { view.setUint8(0, value); }
// 		}
// 	}
//
// 	function descriptor16(buffer, offset) {
// 		const view = new DataView(buffer, offset, 2);
// 		return {
// 			enumerable: true,
// 			get() { return view.getUint16(0, false); },
// 			set(value) { view.setUint16(0, value, false); }
// 		}
// 	}
//
// 	const header = { flags: {} };
// 	Object.defineProperties(header, {
// 		version:                           descriptor8 (buffer, 0x00),
// 		flags1:                            descriptor8 (buffer, 0x01),
// 		highMemoryBase:                    descriptor16(buffer, 0x04),
// 		initialProgramCounter:             descriptor16(buffer, 0x06),
// 		dictionaryAddress:                 descriptor16(buffer, 0x08),
// 		objectTableAddress:                descriptor16(buffer, 0x0A),
// 		globalTableAddress:                descriptor16(buffer, 0x0C),
// 		staticMemoryBase:                  descriptor16(buffer, 0x0E),
// 		flags2:                            descriptor8 (buffer, 0x10),
// 		abbreviationsTableAddress:         descriptor16(buffer, 0x18),
// 		fileLength: ((buffer, offset) => {
// 			const view = new DataView(buffer, offset, 2);
// 			return {
// 				enumerable: true,
// 				get() {
// 					const divisor =
// 						header.version <= 3 ? 2 :
// 						header.version <= 5 ? 4 :
// 						8;
// 					return view.getUint16(0, false) * divisor;
// 				},
// 				set(value) {
// 					const divisor =
// 						header.version <= 3 ? 2 :
// 						header.version <= 5 ? 4 :
// 						8;
// 					view.setUint16(0, (value / divisor) | 0, false);
// 				}
// 			}
// 		})(buffer, 0x1A),
// 		fileChecksum:                      descriptor16(buffer, 0x1C),
// 		interpreterNumber:                 descriptor8 (buffer, 0x1E),
// 		interpreterVersion:                descriptor8 (buffer, 0x1F),
// 		screenHeightLines:                 descriptor8 (buffer, 0x20),
// 		screenWidthCharacters:             descriptor8 (buffer, 0x21),
// 		screenWidthUnits:                  descriptor16(buffer, 0x22),
// 		screenHeightUnits:                 descriptor16(buffer, 0x24),
// 		fontWidthUnits:                    descriptor8 (buffer, 0x26),
// 		fontHeightUnits:                   descriptor8 (buffer, 0x27),
// 		routinesOffset:                    descriptor16(buffer, 0x28),
// 		staticStringsOffset:               descriptor16(buffer, 0x2A),
// 		defaultBackgroundColor:            descriptor8 (buffer, 0x2C),
// 		defaultForegroundColor:            descriptor8 (buffer, 0x2D),
// 		terminatingCharactersTableAddress: descriptor16(buffer, 0x2E),
// 		standardRevisionNumber:            descriptor16(buffer, 0x32),
// 		alphabetTableAddress:              descriptor16(buffer, 0x34),
// 		headerExtensionTableAddress:       descriptor16(buffer, 0x36)
// 	});
//
// 	Object.defineProperties(header.flags, {
// 		// versions 1-3
// 		statusLineType: descriptor1(buffer, 0x01, 1),
// 		storyFileSplit: descriptor1(buffer, 0x01, 2),
// 		statusLineNotAvailable: descriptor1(buffer, 0x01, 4),
// 		screenSplittingAvailable: descriptor1(buffer, 0x01, 5),
// 		variablePitchFontDefault: descriptor1(buffer, 0x01, 6),
//
// 		// versions 4+
// 		colorsAvailable: descriptor1(buffer, 0x01, 0),
// 		pictureDisplayingAvailable: descriptor1(buffer, 0x01, 1),
// 		boldAvailable: descriptor1(buffer, 0x01, 2),
// 		italicsAvailable: descriptor1(buffer, 0x01, 3),
// 		fixedSpaceFontAvailable: descriptor1(buffer, 0x01, 4),
// 		soundEffectsAvailable: descriptor1(buffer, 0x01, 5),
// 		timedKeyboardInputAvailable: descriptor1(buffer, 0x01, 7),
//
// 		transcriptingOn: descriptor1(buffer, 0x10, 0),
// 		forceFixedPitch: descriptor1(buffer, 0x10, 1),
// 		statusLineRedrawRequested: descriptor1(buffer, 0x10, 2),
// 		picturesRequested: descriptor1(buffer, 0x10, 3),
// 		undoRequested: descriptor1(buffer, 0x10, 4),
// 		mouseRequested: descriptor1(buffer, 0x10, 5),
// 		colorsRequested: descriptor1(buffer, 0x10, 6),
// 		soundEffectsRequested: descriptor1(buffer, 0x10, 7),
// 		menusRequested: descriptor1(buffer, 0x11, 0)
// 	});
//
// 	return header;
// }
