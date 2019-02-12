const fs = require('fs');
const readline = require('readline');
const getOpcodeTable = require('./getOpcodeTable');
const run = require('./run');

const state = init(process.argv[2] || './stories/zork1.z3');

let random;
if (process.argv[3]) {
	const randomNumbers = Array.from(fs.readFileSync(process.argv[3] || './random.txt'));
	random = function random(max) {
		if (randomNumbers.length) {
			const value = randomNumbers.shift() + 1;
			console.log(`RANDOM ${max} -> ${value}`);
			if (value > max) {
				throw new Error(`random value ${value} out of range ${max}`);
			}
			return value;
		} else {
			console.log(`RANDOM ${max}`);
			throw new Error('ran out of randomness');
		}
	}
} else {
	random = function random(max) {
		return ((Math.random()*(max-1)) | 0) + 1;
	}
}

main(state)
	.then(console.log)
	.catch(e => {
		console.error(e);
		process.exit(1);
	});

function init(filename) {
	const file = fs.readFileSync(filename);
	const memory = Array.from(file);

	return {
		memory,
		stack: [{ stack: [] }],
		pc: memory[0x06] << 8 | memory[0x07],
		opcodeTable: getOpcodeTable(memory[0])
	};
}

const bufferedInput = [];
const rl = readline.createInterface({
	input: process.stdin
});
rl.on('line', line => bufferedInput.push(line));

async function main(state) {
	const output = { text: '' };
	let input;
	for (;;) {
		const runState = run(state, output, input, random);
		input = null;
		if (runState === 'yield') {
			// TODO add status line
			await new Promise(resolve => process.stdout.write(output.text, resolve));
			output.text = '';

			if (!bufferedInput.length) {
				await new Promise(resolve => rl.on('line', resolve));
			}

			input = bufferedInput.shift();
			if (!process.stdin.isTTY) {
				process.stdout.write(input);
				process.stdout.write('\n');
			}
		} else if (runState === 'quit') {
			await new Promise(resolve => process.stdout.write(output.text, resolve));
			process.exit(0);
		}
	}
}
