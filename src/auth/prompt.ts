import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    // Temporarily disable echo for password input
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let input = "";
    const onData = (data: Buffer) => {
      const char = data.toString();
      if (char === "\n" || char === "\r") {
        stdin.removeListener("data", onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        process.stdout.write("\n");
        resolve(input);
      } else if (char === "\u007f" || char === "\b") {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (char === "\u0003") {
        // Ctrl+C
        process.exit(1);
      } else {
        input += char;
        process.stdout.write("*");
      }
    };

    stdin.resume();
    stdin.on("data", onData);
  });
}

export async function promptChoice(question: string, choices: string[]): Promise<number> {
  console.log(`\n  ${question}\n`);
  for (let i = 0; i < choices.length; i++) {
    console.log(`  ${i + 1}. ${choices[i]}`);
  }

  while (true) {
    const answer = await ask(`\n  Choose [1-${choices.length}]: `);
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= choices.length) {
      return num - 1;
    }
    console.log("  Invalid choice, try again.");
  }
}

export async function promptText(question: string): Promise<string> {
  return ask(`  ${question} `);
}

export async function promptSecret(question: string): Promise<string> {
  return askSecret(`  ${question} `);
}

export async function promptConfirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(`  ${question} ${hint} `);
  if (answer === "") return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

export function closePrompt(): void {
  rl.close();
}
