const fs = require('fs');
const readline = require('readline');
const getOpcodeTable = require('./getOpcodeTable');
const run = require('./run');

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

const state = init(process.argv[2] || './stories/zork1.z3');

main(state)
	.then(console.log)
	.catch(e => {
		console.error(e);
		process.exit(1);
	});

function init(filename) {
	const file = fs.readFileSync(process.argv[2] || './stories/zork1.z3');
	const memory = Array.from(file);

	return {
		memory,
		stack: [{ stack: [] }],
		pc: memory[0x06] << 8 | memory[0x07],
		opcodeTable: getOpcodeTable(memory[0])
	};
}

async function main(state) {
	const output = { text: '' };
	let input;
	for (;;) {
		const yielded = run(state, output, input);
		input = null;
		if (yielded) {
			// TODO add status line
			console.log(output.text);
			output.text = '';
			input = await new Promise(resolve => { rl.question('', resolve); });
		}
	}
}
