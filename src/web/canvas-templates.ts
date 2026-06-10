export interface CanvasTemplate {
	name: string;
	description: string;
	files: Record<string, string>;
}

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
	{
		name: "Blank HTML",
		description: "A minimal HTML page",
		files: {
			"index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canvas</title>
</head>
<body>
  <h1>Hello, Canvas!</h1>
</body>
</html>`,
		},
	},
	{
		name: "HTML + CSS + JS",
		description: "HTML with separate CSS and JS files",
		files: {
			"index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canvas</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1 id="title">Hello, Canvas!</h1>
  <script src="app.js"></script>
</body>
</html>`,
			"style.css": `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #f8f9fb;
  color: #111827;
}

h1 {
  font-size: 2rem;
}
`,
			"app.js": `document.addEventListener("DOMContentLoaded", () => {
  console.log("Canvas app loaded");
});
`,
		},
	},
	{
		name: "React Component",
		description: "A single-file React app using CDN",
		files: {
			"index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>React Canvas</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #f8f9fb; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    function App() {
      const [count, setCount] = React.useState(0);
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 16 }}>
          <h1>React Canvas</h1>
          <p>Count: {count}</p>
          <button onClick={() => setCount(c => c + 1)} style={{ padding: "8px 16px", fontSize: 16, cursor: "pointer" }}>
            Increment
          </button>
        </div>
      );
    }
    ReactDOM.createRoot(document.getElementById("root")).render(<App />);
  </script>
</body>
</html>`,
		},
	},
	{
		name: "SVG Drawing",
		description: "An interactive SVG canvas",
		files: {
			"index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG Canvas</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f8f9fb; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    svg { border: 1px solid #e2e4e9; border-radius: 8px; background: #fff; }
  </style>
</head>
<body>
  <svg width="600" height="400" viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
    <rect x="50" y="50" width="100" height="100" fill="#7458f5" rx="8" />
    <circle cx="300" cy="200" r="60" fill="#f59e0b" />
    <polygon points="450,80 520,200 380,200" fill="#10b981" />
    <text x="300" y="350" text-anchor="middle" font-family="system-ui" font-size="18" fill="#6b7280">
      Edit this SVG!
    </text>
  </svg>
</body>
</html>`,
		},
	},
];
