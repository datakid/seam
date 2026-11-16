export async function launch(name = 'chromium') {
  const playwright = await import('playwright-core');
  const engine = playwright[name];
  if (!engine) throw new Error(`unknown browser: ${name}`);
  try {
    return await engine.launch({ headless: true });
  } catch (error) {
    if (name !== 'chromium') throw error;
    let bundled;
    try {
      bundled = (await import('@sparticuz/chromium')).default;
    } catch {
      throw error;
    }
    return engine.launch({ executablePath: await bundled.executablePath(), args: bundled.args, headless: true });
  }
}
