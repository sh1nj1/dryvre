import { expect, test } from "@playwright/test";

test("introduces Dryvre and opens the existing product from the primary CTA", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /One tree.*Every way of working/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Agents do not guess past a blocker/ }),
  ).toBeVisible();
  await expect(page.locator("video source")).toHaveAttribute(
    "src",
    "/dryvre-demo.mp4",
  );

  await page
    .locator(".hero-actions")
    .getByRole("link", { name: /Start building/ })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("tablist", { name: "View mode" })).toBeVisible();
});

test("keeps the landing story readable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator(".landing-nav nav")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: /One tree.*Every way of working/ }),
  ).toBeVisible();
  await expect(page.locator(".product-preview")).toBeVisible();
  await expect(page.locator(".problem-grid article")).toHaveCount(3);
});
