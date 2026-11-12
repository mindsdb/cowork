import { host } from '../../platform/host';

/* The app stores forbid an app from selling a digital service outside their
   own in-app purchase, or from linking out to buy one (App Store guideline
   3.1.1, Google Play's payments policy). The mobile app has no in-app
   purchase, so inside it nothing offers to add funds, set up auto top up,
   change a budget or open the billing console. It can still say that a limit
   was reached. Everywhere else, billing links show as before. */

/** Whether this surface may offer a purchase or link to billing. */
export function offersBilling(): boolean {
  return !host.isMobileShell;
}

/** The billing actions a surface may show: all of them, or none inside the
 *  mobile app. Spread it into a list that also holds other actions. */
export function billingActions<T>(actions: readonly T[] | null | undefined): T[] {
  return offersBilling() && actions ? [...actions] : [];
}
