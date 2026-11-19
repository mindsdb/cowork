// The product's stock names. Every place that names the product uses one of
// these, so main/branding.test.ts can catch a name hard-coded anywhere else.
// On a web build with a deployment brand, the surfaces the brand covers show
// the brand's name in their place (renderer/lib/deploymentBrand.ts).

/** The full name: the tab, the welcome screen, search and the phone header. */
export const STOCK_PRODUCT_NAME = 'MindsHub Cowork';

/** The sidebar wordmark. */
export const STOCK_WORDMARK = 'MindsHub';

/** The short name, as in "Sign out of Cowork?". */
export const STOCK_SHORT_NAME = 'Cowork';
