module.exports = function initHeaderFlags(memory) {
	if (memory[0] <= 3) {
		memory[0x01] |= (
			(1 << 4)   // Status line not available?
		);
		memory[0x01] &= ~(
			(1 << 5) | // Screen-splitting available?
			(1 << 6)   // Is a variable-pitch font the default?
		);
	} else {
		memory[0x01] &= ~(
			(1 << 0) | // Colours available?
			(1 << 1) | // Picture displaying available?
			(1 << 2) | // Boldface available?
			(1 << 3) | // Italic available?
			(1 << 4) | // Fixed-space font available?
			(1 << 5) | // Sound effects available?
			(1 << 7)   // Timed keyboard input available?
		);
		memory[0x10] &= ~(
			// (For bits 3,4,5,7 and 8, Int clears again if it cannot provide the requested effect.)
			(1 << 3) | // 3: If set, game wants to use pictures
			(1 << 4) | // 4: If set, game wants to use the UNDO opcodes
			(1 << 5) | // 5: If set, game wants to use a mouse
			(1 << 7) | // 7: If set, game wants to use sound effects
			(1 << 8) // 8: If set, game wants to use menus
		);
	}
}
