import { isMindsBaseUrl } from '../../../../shared/minds-endpoint';
import { providerValueToType } from '../../lib/settingsTransform';

// A publishing credential also backfills a MindsHub card in settingsTransform.
// Only inference routed to MindsHub warrants that card without platform UI.
export function visibleProviderCards(settings, providers, platformUi) {
  if (platformUi) return providers;
  const baseUrl = (settings.openaiBaseUrl || '').trim();
  const usesMindsEndpoint = [settings.planningProvider, settings.codingProvider, settings.routerProvider]
    .some((type) => providerValueToType(type) === 'minds-cloud')
    || (Boolean(baseUrl) && isMindsBaseUrl(baseUrl, settings.mindsUrl));
  return providers.filter((provider) => provider.type !== 'minds-cloud'
    || (usesMindsEndpoint && Boolean(provider.apiKey || settings.mindsApiKey)));
}
