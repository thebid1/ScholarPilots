const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();

  const screenshot = async (name) => {
    await page.screenshot({ path: `/home/thebid/scholar/screenshots/${name}.png`, fullPage: false });
    console.log('Screenshot:', name);
  };

  try {
    await page.addInitScript(() => {
      localStorage.clear();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      }
    });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    await screenshot('01-onboarding-mobile');

    // Step 1
    await page.fill('input[type="text"]', 'Ada Obi');
    await page.selectOption('select', 'Computer Science');
    await page.click('button:has-text("Next step")');

    // Step 2
    await page.waitForSelector('input[type="number"]', { timeout: 5000 });
    await page.fill('input[type="number"]', '4.35');
    await page.click('button:has-text("MSc")');
    await page.click('button:has-text("Next step")');

    // Step 3
    await page.waitForSelector('textarea', { timeout: 5000 });
    await page.click('button:has-text("UK")');
    await page.click('button:has-text("US")');
    await page.fill('textarea', 'I want to use technology to improve public healthcare in Nigeria.');
    await page.click('button:has-text("Save profile")');

    await page.waitForSelector('text=Hi, Ada', { timeout: 10000 });
    await screenshot('02-home-mobile');

    // Opportunities
    await Promise.all([
      page.waitForURL('**/opportunities', { timeout: 10000 }),
      page.click('a[href="/opportunities"]'),
    ]);
    await page.waitForSelector('h1:has-text("Discover")', { timeout: 10000 });
    await screenshot('03-opportunities-mobile');

    // Track first two scholarships
    const trackButtons = await page.locator('button:has-text("Track application")').all();
    if (trackButtons.length >= 2) {
      await trackButtons[0].click();
      await page.waitForTimeout(400);
      await trackButtons[1].click();
      await page.waitForTimeout(400);
    }
    await screenshot('04-opportunities-tracked-mobile');

    // Applications
    await Promise.all([
      page.waitForURL('**/applications', { timeout: 10000 }),
      page.click('a[href="/applications"]'),
    ]);
    await page.waitForSelector('h1:has-text("Pipeline")', { timeout: 10000 });
    await screenshot('05-applications-mobile');

    // Expand timeline and mark milestone
    const timelineButtons = await page.locator('button:has-text("Timeline")').all();
    if (timelineButtons.length > 0) {
      await timelineButtons[0].click();
      await page.waitForTimeout(300);
      const milestoneButtons = await page.locator('button[aria-label^="Mark"]').all();
      if (milestoneButtons.length > 0) {
        await milestoneButtons[0].click();
        await page.waitForTimeout(800);
      }
    }
    await screenshot('06-applications-milestone-mobile');

    // Chat
    await Promise.all([
      page.waitForURL('**/chat', { timeout: 10000 }),
      page.click('a[href="/chat"]'),
    ]);
    await page.waitForSelector('text=ScholarPilot', { timeout: 10000 });
    await screenshot('07-chat-empty-mobile');

    // Ask SOP
    await page.click('button:has-text("SOP")');
    await page.waitForTimeout(2500);
    await screenshot('08-chat-sop-mobile');

    // Ask deadlines
    await page.click('button:has-text("Deadlines")');
    await page.waitForTimeout(2500);
    await screenshot('09-chat-deadlines-mobile');

    console.log('Mobile demo flow completed successfully.');
  } catch (err) {
    console.error('Demo flow error:', err);
    await screenshot('error-mobile');
  } finally {
    await browser.close();
  }
})();
