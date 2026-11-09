const { test, expect } = require('@playwright/test');
const original = require('./fixtures/original-breakfasts.json');
async function open(page, date = '2026-11-09T10:00:00+01:00') {
  await page.clock.install({ time: new Date(date) });
  await page.goto('/');
}
async function choose(picker, id) {
  const count = Number((await picker.locator('.meal-position').textContent()).match(/\/ (\d+)/)[1]);
  for (let step = 0; step < count; step++) {
    if (await picker.getAttribute('data-recipe') === id) return;
    await picker.locator('[data-step="1"]').click();
  }
  await expect(picker).toHaveAttribute('data-recipe', id);
}
async function outside(page) {
  for (const picker of await page.locator('.meal-picker').all()) await choose(picker, 'delivery');
}
test('preserves unchanged breakfasts, gives 10 choices per meal, saves choices and illustration', async ({ page }) => {
  await open(page);
  await expect(page.locator('.calendar-day')).toHaveCount(7);
  await expect(page.locator('.meal-picker')).toHaveCount(14);
  await expect(page.locator('select')).toHaveCount(0);
  for (const picker of await page.locator('.meal-picker').all()) await expect(picker.locator('.meal-position')).toContainText('/ 10');
  expect(await page.evaluate(() => classicBreakfasts.map(({ id, ...dish }) => dish)))
    .toEqual(original.filter(dish => !dish.restaurant && dish.title !== 'Ёгурт з гранолай'));
  const select = page.locator('.meal-picker').first();
  await choose(select, 'syrniki');
  await expect(page.locator('.meal-image').first()).toHaveAttribute('src', 'assets/meals/syrniki.webp');
  await page.reload();
  await expect(select).toHaveAttribute('data-recipe', 'syrniki');
  await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date','2026-11-09');
});
test('external meals empty the list and repeated recipes aggregate correctly', async ({ page }) => {
  await open(page);
  await outside(page);
  await expect(page.locator('#shopping input')).toHaveCount(0);
  await expect(page.locator('#progress')).toHaveText('0 з 0 куплена');
  await choose(page.locator('.meal-picker').first(), 'restaurant');
  await expect(page.locator('#shopping input')).toHaveCount(0);
  await choose(page.locator('.meal-picker[data-meal="breakfast"]').nth(0), 'omelet');
  await choose(page.locator('.meal-picker[data-meal="breakfast"]').nth(1), 'omelet');
  await expect(page.locator('[data-product-id="spinach"]')).toContainText('200 г');
  await expect(page.locator('[data-product-id="orange_juice"]')).toContainText('0,8 л');
  await expect(page.locator('[data-product-id="orange_juice"]')).toContainText('бутэлькі па 1 л: 1');
  await choose(page.locator('.meal-picker[data-meal="dinner"]').first(), 'chicken-barley');
  await expect(page.locator('[data-product-id="chicken"]')).toContainText('400 г');
});
test('preserves unchanged purchases, clears changed totals, supports undo and reset', async ({ page }) => {
  await open(page);
  await outside(page);
  await choose(page.locator('.meal-picker').first(), 'omelet');
  await page.locator('#product-spinach').check();
  await page.clock.runFor(400);
  await expect(page.locator('#undoSnackbar')).toBeVisible();
  await page.locator('.undo-snackbar-action').click();
  await page.clock.runFor(400);
  await expect(page.locator('#product-spinach')).not.toBeChecked();
  await page.locator('#product-spinach').check();
  await page.clock.runFor(400);
  await choose(page.locator('.meal-picker[data-meal="dinner"]').first(), 'chicken-barley');
  await expect(page.locator('#product-spinach')).toHaveCount(0);
  await choose(page.locator('.meal-picker[data-meal="breakfast"]').nth(1), 'omelet');
  await expect(page.locator('#product-spinach')).not.toBeChecked();
  await page.locator('#product-spinach').check();
  await page.clock.runFor(400);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#resetBtn').click();
  await expect(page.locator('#product-spinach')).not.toBeChecked();
  await expect(page.locator('.meal-picker').first()).toHaveAttribute('data-recipe', 'omelet');
});
for (const [name, initial, next, last] of [
  ['year', '2026-12-31T23:59:59+01:00','2027-01-01','2027-01-07'],
  ['month', '2026-11-30T23:59:59+01:00','2026-12-01','2026-12-07'],
  ['spring DST', '2026-03-28T23:59:59+01:00','2026-03-29','2026-04-04'],
  ['autumn DST', '2026-10-24T23:59:59+02:00','2026-10-25','2026-10-31']
]) test(`rolls dates across ${name} and preserves tomorrow's choices`, async ({ page }) => {
  await open(page, initial);
  await choose(page.locator('.meal-picker[data-meal="dinner"]').nth(1), 'delivery');
  await page.clock.runFor(1500);
  await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date',next);
  await expect(page.locator('.calendar-day').last()).toHaveAttribute('data-date',last);
  await expect(page.locator('.meal-picker[data-meal="dinner"]').first()).toHaveAttribute('data-recipe', 'delivery');
  expect(await page.locator('.calendar-day').evaluateAll(els => new Set(els.map(el => el.dataset.date)).size)).toBe(7);
});
test('refreshes on focus and handles corrupt or unavailable storage', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meal-plan-v1','broken json'));
  await open(page);
  await expect(page.locator('.meal-picker')).toHaveCount(14);
  await choose(page.locator('.meal-picker[data-meal="dinner"]').nth(1), 'delivery');
  await page.clock.setSystemTime(new Date('2026-11-10T10:00:00+01:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date','2026-11-10');
  await expect(page.locator('.meal-picker[data-meal="dinner"]').first()).toHaveAttribute('data-recipe', 'delivery');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
  await choose(page.locator('.meal-picker').first(), 'delivery');
  await expect(page.locator('#storageNotice')).toBeVisible();
  await expect(page.locator('.meal-picker').first()).toHaveAttribute('data-recipe', 'delivery');
});
test('mobile layout has no overflow and keyboard selection works', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const picker = page.locator('.meal-picker').first();
  await picker.locator('.meal-viewport').focus();
  await page.keyboard.press('ArrowRight');
  await expect(picker).toHaveAttribute('data-recipe', 'omelet');
  await expect(picker.locator('.meal-viewport')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(picker).toHaveAttribute('data-recipe', 'oatmeal');
  await picker.locator('[data-step="-1"]').focus();
  await page.keyboard.press('Enter');
  await expect(picker).toHaveAttribute('data-recipe', 'delivery');
  await expect(picker.locator('[data-step="-1"]')).toBeFocused();
  await picker.locator('[data-step="1"]').click();
  await expect(picker).toHaveAttribute('data-recipe', 'oatmeal');
});
test('every illustrated choice loads and unavailable images do not block selection', async ({ page }) => {
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const ids = await page.evaluate(() => Object.keys(recipes));
  expect(ids).toHaveLength(18);
  for (const id of ids) {
    const response = await page.request.get(`/assets/meals/${id}.webp`);
    expect(response.ok(), id).toBe(true);
    expect(response.headers()['content-type']).toContain('image/webp');
  }
  await expect(page.locator('#dateRange')).toHaveText('9 лістапада — 15 лістапада');
  await page.route('**/assets/meals/syrniki.webp', route => route.abort());
  await choose(page.locator('.meal-picker').first(), 'syrniki');
  await expect(page.locator('.meal-image').first()).toBeHidden();
  await choose(page.locator('.meal-picker').first(), 'delivery');
  await expect(page.locator('.meal-picker').first()).toHaveAttribute('data-recipe', 'delivery');
  expect(errors).toEqual([]);
});
test('changing menu during purchase animation cannot restore stale undo entries', async ({ page }) => {
  await open(page);
  await page.locator('#shopping input').first().check();
  await choose(page.locator('.meal-picker').first(), 'delivery');
  await page.clock.runFor(500);
  await expect(page.locator('#undoSnackbar')).toBeHidden();
  const [done,total] = (await page.locator('#progress').textContent()).match(/\d+/g).map(Number);
  expect(done).toBeLessThanOrEqual(total);
});

test.describe('swipe selection', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 900 } });
  async function gesture(page, picker, dx, dy, cancel = false) {
    const viewport = picker.locator('.meal-viewport');
    await viewport.scrollIntoViewIfNeeded();
    const box = await viewport.boundingBox();
    const x = box.x + box.width * (dx < 0 ? .78 : .22);
    const y = box.y + box.height * .55;
    const input = await page.context().newCDPSession(page);
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) {
      await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 6, y: y + dy * step / 6 }] });
      await page.clock.runFor(16);
    }
    await input.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    await page.clock.runFor(250);
    await input.detach();
  }
  test('touch swipes select both directions, persist, update purchases and wrap around', async ({ page }) => {
    await open(page);
    const picker = page.locator('.meal-picker').first();
    await gesture(page, picker, -160, 2);
    await expect(picker).toHaveAttribute('data-recipe', 'omelet');
    await expect(picker.locator('img')).toHaveAttribute('src', 'assets/meals/omelet.webp');
    await expect(page.locator('[data-product-id="spinach"]')).toContainText('200 г');
    await expect(page.locator('.meal-picker[data-meal="dinner"]').first()).toHaveAttribute('data-recipe', 'chicken-barley');
    await page.reload();
    await expect(picker).toHaveAttribute('data-recipe', 'omelet');
    await gesture(page, picker, 160, 2);
    await expect(picker).toHaveAttribute('data-recipe', 'oatmeal');
    await gesture(page, picker, 160, 0);
    await expect(picker).toHaveAttribute('data-recipe', 'delivery');
    await gesture(page, picker, 160, 0);
    await expect(picker).toHaveAttribute('data-recipe', 'restaurant');
    await gesture(page, picker, -160, 0);
    await expect(picker).toHaveAttribute('data-recipe', 'delivery');
    await gesture(page, picker, -160, 0);
    await expect(picker).toHaveAttribute('data-recipe', 'oatmeal');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test('vertical scroll, short drags and canceled touches do not select a dish', async ({ page }) => {
    await open(page);
    const picker = page.locator('.meal-picker').first();
    await gesture(page, picker, -25, 0);
    await expect(picker).toHaveAttribute('data-recipe', 'oatmeal');
    await gesture(page, picker, -150, 0, true);
    await expect(picker).toHaveAttribute('data-recipe', 'oatmeal');
    await expect(picker.locator('.meal-viewport')).not.toHaveClass(/dragging/);
    await picker.locator('.meal-viewport').scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => scrollY);
    await gesture(page, picker, 4, -160);
    await expect(picker).toHaveAttribute('data-recipe', 'oatmeal');
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gesture(page, picker, -160, 0);
    await expect(picker).toHaveAttribute('data-recipe', 'omelet');
    await expect(picker.locator('.meal-slide')).toHaveCSS('animation-name', 'none');
  });
});

test('mouse dragging changes one meal at a time', async ({ page }) => {
  await open(page);
  const picker = page.locator('.meal-picker').first();
  await picker.locator('.meal-viewport').scrollIntoViewIfNeeded();
  const box = await picker.locator('.meal-viewport').boundingBox();
  const x = box.x + box.width * .8, y = box.y + box.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 150, y + 3, { steps: 6 });
  await page.mouse.up();
  await expect(picker).toHaveAttribute('data-recipe', 'omelet');
  await expect(picker.locator('.meal-viewport')).not.toHaveClass(/dragging/);
});

test('revised catalog excludes removed dishes and ingredients', async ({ page }) => {
  await open(page);
  const catalog = await page.evaluate(() => Object.values(recipes));
  const ids = catalog.map(dish => dish.id);
  for (const removed of ['yogurt', 'oat-pancakes', 'bean-stew', 'stuffed-potatoes', 'chickpea-rice', 'crepes', 'buckwheat-eggs', 'chicken-rice', 'vegetable-pasta', 'lentils']) {
    expect(ids).not.toContain(removed);
  }
  expect(catalog.filter(dish => dish.type === 'breakfast')).toHaveLength(8);
  expect(catalog.filter(dish => dish.type === 'dinner')).toHaveLength(8);
  expect(catalog.flatMap(dish => dish.ingredients.map(i => i.product))).not.toContain('rice');
  expect(catalog.flatMap(dish => dish.ingredients.map(i => i.product))).not.toContain('granola');
});

test('old saved choices migrate to new recipes and removed choices fall back safely', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('meal-plan-v1')) return;
    localStorage.setItem('meal-plan-v1', JSON.stringify({
      '2026-11-09': { breakfast: 'crepes', dinner: 'chicken-rice' },
      '2026-11-10': { breakfast: 'buckwheat-eggs', dinner: 'vegetable-pasta' },
      '2026-11-11': { breakfast: 'yogurt', dinner: 'lentils' },
      '2026-11-12': { breakfast: 'oat-pancakes', dinner: 'bean-stew' },
      '2026-11-13': { breakfast: 'oatmeal', dinner: 'stuffed-potatoes' },
      '2026-11-14': { breakfast: 'delivery', dinner: 'chickpea-rice' },
      '2026-11-15': { breakfast: 'restaurant', dinner: 'tuna-salad' }
    }));
    localStorage.setItem('breakfast-checklist-v2', JSON.stringify({ 'product-rice': true, 'product-granola': true }));
  });
  await open(page);
  const expected = [
    ['salmon-crepes','chicken-barley'], ['buckwheat-salmon','shrimp-pasta'],
    ['casserole','lentils-turkey'], ['avocado-toast','mushroom-buckwheat'],
    ['oatmeal','turkey-bulgur'], ['delivery','lentils-turkey'], ['restaurant','tuna-salad']
  ].flat();
  expect(await page.locator('.meal-picker').evaluateAll(els => els.map(el => el.dataset.recipe))).toEqual(expected);
  await expect(page.locator('#progress')).toContainText('0 з');
  await expect(page.locator('[data-product-id="rice"]')).toHaveCount(0);
  await expect(page.locator('[data-product-id="granola"]')).toHaveCount(0);
  await page.reload();
  expect(await page.locator('.meal-picker').evaluateAll(els => els.map(el => el.dataset.recipe))).toEqual(expected);
});

test('new dishes contribute the correct ingredients to shopping', async ({ page }) => {
  await open(page);
  await outside(page);
  const breakfasts=page.locator('.meal-picker[data-meal="breakfast"]');
  const dinners=page.locator('.meal-picker[data-meal="dinner"]');
  await choose(breakfasts.nth(0),'salmon-crepes');
  await choose(breakfasts.nth(1),'buckwheat-salmon');
  await expect(page.locator('[data-product-id="salmon"]')).toContainText('360 г');
  await expect(page.locator('[data-product-id="cream_cheese"]')).toContainText('220 г');
  await expect(page.locator('[data-product-id="cucumber"]')).toContainText('1 шт.');
  await expect(page.locator('[data-product-id="berries"]')).toHaveCount(0);
  await expect(page.locator('[data-product-id="cottage_cheese"]')).toHaveCount(0);
  await choose(dinners.nth(0),'chicken-barley');
  await choose(dinners.nth(1),'shrimp-pasta');
  await choose(dinners.nth(2),'lentils-turkey');
  await choose(dinners.nth(3),'beef-tartare');
  for (const [id,amount] of [['barley',160],['shrimp',300],['cherry_tomatoes',250],['turkey',300],['beef',300],['capers',20]]) {
    await expect(page.locator(`[data-product-id="${id}"]`)).toContainText(`${amount} г`);
  }
  await expect(page.locator('[data-product-id="rice"]')).toHaveCount(0);
  for (const [picker,id] of [[breakfasts.nth(0),'salmon-crepes'],[breakfasts.nth(1),'buckwheat-salmon'],[dinners.nth(1),'shrimp-pasta'],[dinners.nth(3),'beef-tartare']]) {
    await expect(picker.locator('img')).toHaveAttribute('src',`assets/meals/${id}.webp`);
  }
});
