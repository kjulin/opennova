export async function run() {
  const { start } = await import("../index.js");
  start();
}
