export async function launch(name = 'chromium') {
  const playwright = await import('playwright-core');
  const engine = playwright[name];
  if (!engine) throw new Error(`unknown browser: ${name}`);
  try {
    const executablePath = name === 'chromium' && process.env.SEAM_CHROMIUM ? process.env.SEAM_CHROMIUM : undefined;
    return await engine.launch({ headless: true, executablePath, args: name === 'chromium' ? ['--enable-precise-memory-info'] : [] });
  } catch (error) {
    if (name !== 'chromium') throw error;
    let bundled;
    try {
      bundled = (await import('@sparticuz/chromium')).default;
    } catch {
      throw error;
    }
    return engine.launch({ executablePath: await bundled.executablePath(), args: [...bundled.args, '--enable-precise-memory-info'], headless: true });
  }
}
