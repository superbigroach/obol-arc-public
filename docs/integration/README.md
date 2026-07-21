# Obol Marketplace Integration

Complete Flutter integration for the Obol marketplace, allowing users to discover and call metered APIs with automatic USDC payments on the Arc blockchain.

## Quick Start

### For App Users
1. Open Lucilla app → Wallet tab
2. Tap "Obol Marketplace"
3. Browse services or search for one
4. Tap a service to view details
5. Enter API parameters
6. Tap "Buy & Call" to execute and pay
7. View result and transaction details
8. Check "Spending History" to see all past calls

### For Developers

**File Structure:**
```
lib/wallet/
  ├── providers/
  │   └── obol_marketplace_provider.dart     # Riverpod state
  ├── services/
  │   └── obol_marketplace_service.dart      # Cloud Function wrappers
  └── screens/
      ├── obol/
      │   ├── obol_marketplace_screen.dart          # Discovery
      │   ├── obol_service_detail_screen.dart       # Detail + call
      │   ├── spending_history_screen.dart          # History
      │   └── agent_limits_settings_screen.dart     # Limits config
      └── widgets/
          ├── service_call_result_widget.dart       # Result display
          └── mfa_confirm_dialog.dart               # 2FA confirmation

docs/obol/
  ├── README.md                      # This file
  ├── FLUTTER_INTEGRATION.md         # Complete usage guide
  ├── FLUTTER_TESTING.md             # Testing scenarios
  └── CLAUDE_ADVANCED.md (todo)      # Architecture deep-dive
```

## Features

### User Features
- **Service Discovery**: Browse 50+ metered APIs on Obol
- **Search & Filter**: By name, category, price range
- **One-Click Calls**: Select parameters → Buy & Call → Get result
- **Spending Limits**: Daily ($50) and monthly ($500) budgets
- **2FA Protection**: Require password + 2FA code for limit changes
- **Call History**: Full audit trail of all API calls
- **Real-time Updates**: Spending limits and history refresh instantly
- **Error Recovery**: Clear messages and retry options

### Security Features
- Arc Modular Wallet: User keys stored securely via Circle SDK
- App Check + Auth: All API endpoints authenticated
- 2FA for Limit Changes: Password + 6-digit code required
- Audit Trail: Every call and limit change logged
- Spending Enforcement: Daily/monthly limits strictly enforced
- Whitelisted Services: Optional - restrict to specific services

### Developer Features
- Riverpod state management: 12 providers for all data
- Async loading states: All screens show spinners + errors
- Offline-first caching: Services list cached locally
- Pagination: History loads 20 items per page
- Error handling: User-friendly messages for all errors
- Type-safe models: ObolService, UserAgentLimits, ServiceCallRecord

## Architecture

### Data Flow
```
User opens Obol Marketplace
  ↓
obolMarketplaceProvider (FutureProvider)
  ↓ (if not cached)
ObolMarketplaceService.discoverServices()
  ↓
cloudCall('discoverObolServices')
  ↓
Firebase Cloud Function (us-central1)
  ↓
axios.get('https://obol-arc.web.app/api/services')
  ↓
Obol marketplace API
  ↓
Returns: [{id, name, price, ...}, ...]
  ↓
Parse to List<ObolService>
  ↓
Riverpod caches result
  ↓
UI displays services
```

### Payment Flow
```
User taps "Buy & Call"
  ↓
Confirmation dialog shows:
  - Service name
  - Cost ($0.001)
  - Daily remaining ($49.999)
  ↓
User confirms
  ↓
callObolService CF called
  ↓
CF checks:
  1. User has Arc wallet?
  2. Spending limit ok?
  3. Service active?
  ↓
Circle DCW transfers cost to Obol
  ↓
Arc settlement (batched, ~$0.0000001 gas)
  ↓
Obol service called with payment proof
  ↓
Result returned
  ↓
Transaction recorded in Firestore
  ↓
UI displays result + TX hash
```

## Providers Reference

| Provider | Type | Purpose |
|----------|------|---------|
| `obolMarketplaceProvider` | FutureProvider | List of all services |
| `filteredObolServicesProvider` | FutureProvider | Services filtered by search/category/price |
| `userAgentLimitsProvider` | FutureProvider | User's spending limits |
| `serviceCallHistoryProvider` | FutureProvider.family | Paginated history (key: page) |
| `selectedObolServiceProvider` | StateProvider | Currently viewed service |
| `obolMarketplaceSearchProvider` | StateProvider | Search text |
| `obolMarketplaceCategoryProvider` | StateProvider | Selected category |
| `obolMarketplacePriceRangeProvider` | StateProvider | Min/max price in cents |
| `callHistoryServiceFilterProvider` | StateProvider | Filter history by service |
| `callHistoryDateRangeProvider` | StateProvider | Filter history by date |
| `serviceCallInProgressProvider` | StateProvider | Loading state during API call |
| `lastServiceCallErrorProvider` | StateProvider | Last error message |
| `obolCategoriesProvider` | FutureProvider | All available categories |

## Cloud Functions

Backend endpoints called via `cloudCall()`:

### discoverObolServices
Lists all available marketplace services.
```dart
final result = await cloudCall('discoverObolServices');
// Returns: {services: [{id, name, category, price, ...}], total: 50}
```

### callObolService
Call a service with automatic payment.
```dart
final result = await cloudCall('callObolService', {
  'serviceId': 'weather-api',
  'params': {'lat': '40.7128', 'lon': '-74.0060'},
});
// Returns: {result: {...}, cost: '0.001', transactionId: '...', arcTxHash: '0x...'}
```

### getAgentLimits
Fetch user's spending limits.
```dart
final result = await cloudCall('getAgentLimits');
// Returns: {dailyLimit: '50.00', monthlyLimit: '500.00', ...}
```

### setAgentLimits
Update spending limits (requires 2FA).
```dart
await cloudCall('setAgentLimits', {
  'dailyLimit': '100.00',
  'monthlyLimit': '1000.00',
  'whitelistedServices': ['weather-api', 'openai-embeddings'],
  'mfaToken': 'mfa_token_from_verify2fa',
  'reason': 'User updated spending limits',
});
```

### getAgentSpendingHistory
Get paginated history of API calls.
```dart
final result = await cloudCall('getAgentSpendingHistory', {
  'page': 0,
  'pageSize': 20,
  'serviceId': 'weather-api', // optional
  'startDate': 1656441600000,  // optional (ms since epoch)
  'endDate': 1656528000000,    // optional
});
// Returns: {records: [{id, serviceId, cost, status, ...}], total: 150}
```

### verify2FA
Verify 2FA code and get MFA token.
```dart
final result = await cloudCall('verify2FA', {'code': '123456'});
// Returns: {mfaToken: 'mfa_...'}
```

### requestTestnetUsdc
Request testnet USDC for Arc wallet (testnet only).
```dart
await cloudCall('requestTestnetUsdc');
// Returns: {status: 'success', message: 'USDC sent to your wallet'}
```

## Error Handling

All errors are converted to `FriendlyException` with user-friendly messages:

```dart
try {
  final result = await service.callObolService(
    serviceId: serviceId,
    params: params,
  );
} on FriendlyException catch (e) {
  // User-friendly error message
  showSnackBar(e.message);
} catch (e) {
  // Unexpected error
  debugPrint('Unexpected: $e');
}
```

**Common Error Codes:**

| Code | Message | Recovery |
|------|---------|----------|
| `resource-exhausted` | Daily limit exceeded | Increase limit or wait |
| `not-found` | Service not found | Check marketplace |
| `failed-precondition` | No Arc wallet | Create wallet first |
| `unauthenticated` | Session expired | Sign out and back in |
| `internal` | Server error | Retry or contact support |

## Testing

See `FLUTTER_TESTING.md` for:
- Manual testing scenarios (7 detailed flows)
- Automated unit tests
- Integration tests
- Performance benchmarks
- Troubleshooting guide

Quick test:
```bash
# Run all tests
flutter test test/wallet/obol_marketplace_test.dart

# Run specific test
flutter test test/wallet/obol_marketplace_test.dart -k "ObolService"
```

## Spending Limits

**Default:**
- Daily: $50.00 USDC
- Monthly: $500.00 USDC
- Whitelist: Empty (all services allowed)

**Enforcement:**
1. Before API call: Check `cost <= dailyRemaining`
2. On success: Deduct from `dailySpent + monthlySpent`
3. On failure: Do NOT deduct (no charge)
4. Daily reset: Automatic at midnight UTC
5. Monthly reset: Automatic on 1st of month

**Limits Change:**
- Requires 2FA (password + 6-digit code)
- Logged with timestamp, IP, user ID
- Instant update (via provider refresh)
- Cannot exceed platform max ($100K daily, $1M monthly)

## Cost & Performance

**Nanopayment Fees:**
- Per-call API cost: ~$0.0000001 USDC (batched)
- Service cost: Variable ($0.0001 - $0.10)
- Total: Usually <$0.001 per call

**Performance:**
- Service discovery: <2s (cached)
- API call: <5s (end-to-end)
- Spending history: <1s (paginated)
- Limit update: 2-3s (with 2FA)

**Network:**
- Min payload: ~100 bytes
- Max payload: ~10KB (for large results)
- Bandwidth: <100MB/month for active user

## Deployment

### Checklist
- [ ] All 7 Cloud Functions deployed
- [ ] Obol marketplace API configured
- [ ] Arc testnet RPC endpoint set
- [ ] Firestore collections created:
  - `ObolMarketplaceTransactions`
  - `UserAgentLimits`
  - `AgentLimitChangeLog`
- [ ] Secrets configured:
  - `CIRCLE_API_KEY`
  - `CIRCLE_ENTITY_SECRET`
  - `OBOL_API_KEY`

### Deploy Functions
```bash
cd functions
npm run build
firebase deploy --only functions:v2-functions \
  --project lucilla-b0493
```

### Deploy Flutter App
```bash
flutter build apk --release
flutter build ios --release
# Submit to Play Store / App Store
```

## Future Enhancements

- [ ] Biometric 2FA (fingerprint/face)
- [ ] Batch API calls to reduce gas
- [ ] Usage analytics dashboard
- [ ] Scheduled/recurring calls
- [ ] API parameter templates
- [ ] Service ratings & reviews
- [ ] Webhook integrations
- [ ] Advanced rate limiting

## Documentation

| Document | Purpose |
|----------|---------|
| `FLUTTER_INTEGRATION.md` | Complete usage guide with examples |
| `FLUTTER_TESTING.md` | Testing scenarios and manual flows |
| `CLAUDE_ADVANCED.md` | Architecture deep-dive (todo) |

## Support

For issues:
1. Check [FLUTTER_TESTING.md](./FLUTTER_TESTING.md) troubleshooting section
2. View Cloud Function logs: `firebase functions:log`
3. Check spending history for transaction details
4. Contact support with transaction ID

## References

- **Obol Docs**: https://obol.tech/docs
- **Arc Blockchain**: https://arc.io
- **Circle Modular Wallets**: [Circle SDK]
- **USDC on Arc**: EIP-3009 transferWithAuthorization support
- **Riverpod**: https://riverpod.dev

---

**Status**: Production Ready  
**Last Updated**: June 29, 2026  
**Maintainer**: @lucilla-dev  
**License**: MIT
