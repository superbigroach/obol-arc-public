# Obol Integration - Quick Start for Developers

Copy-paste integration guide for adding Obol to your app.

## Step 1: Add Navigation Routes

Edit `lib/main_routes.dart`:

```dart
// Add these imports at the top
import 'package:lucilla_app/wallet/screens/obol/obol_marketplace_screen.dart';
import 'package:lucilla_app/wallet/screens/obol/obol_service_detail_screen.dart';
import 'package:lucilla_app/wallet/screens/obol/spending_history_screen.dart';
import 'package:lucilla_app/wallet/screens/obol/agent_limits_settings_screen.dart';

// Add these routes to your GoRouter configuration:
GoRoute(
  path: '/wallet/obol/marketplace',
  name: 'obol-marketplace',
  builder: (context, state) => const ObolMarketplaceScreen(),
),
GoRoute(
  path: '/wallet/obol/history',
  name: 'obol-history',
  builder: (context, state) => const SpendingHistoryScreen(),
),
GoRoute(
  path: '/wallet/obol/settings',
  name: 'obol-settings',
  builder: (context, state) => const AgentLimitsSettingsScreen(),
),
```

## Step 2: Add Navigation in Wallet Screen

Edit your main wallet screen (e.g., `lib/wallet/screens/wallet_screen.dart`):

```dart
import 'package:lucilla_app/wallet/providers/obol_marketplace_provider.dart';

// Add these buttons in your wallet screen's navigation:
ListTile(
  leading: const Icon(Icons.api),
  title: const Text('Obol Marketplace'),
  subtitle: const Text('Call metered APIs'),
  trailing: const Icon(Icons.arrow_forward),
  onTap: () => context.goNamed('obol-marketplace'),
),
ListTile(
  leading: const Icon(Icons.history),
  title: const Text('Spending History'),
  subtitle: const Text('View API call history'),
  trailing: const Icon(Icons.arrow_forward),
  onTap: () => context.goNamed('obol-history'),
),
ListTile(
  leading: const Icon(Icons.security),
  title: const Text('Agent Limits'),
  subtitle: const Text('Set spending limits'),
  trailing: const Icon(Icons.arrow_forward),
  onTap: () => context.goNamed('obol-settings'),
),
```

## Step 3: Use Providers in Your App

### Access user spending limits:

```dart
class MyWidget extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final limits = ref.watch(userAgentLimitsProvider);
    
    return limits.when(
      loading: () => const CircularProgressIndicator(),
      error: (err, st) => Text('Error: $err'),
      data: (limit) => Text('Daily: \$${limit.dailyLimit}'),
    );
  }
}
```

### Get all marketplace services:

```dart
class ServiceList extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final services = ref.watch(obolMarketplaceProvider);
    
    return services.when(
      loading: () => const CircularProgressIndicator(),
      error: (err, st) => Text('Error: $err'),
      data: (services) => ListView(
        children: services.map((s) => ListTile(
          title: Text(s.name),
          subtitle: Text('\$${s.pricePerCall}'),
        )).toList(),
      ),
    );
  }
}
```

### Filter marketplace services:

```dart
class SearchWidget extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Set search term
    ref.read(obolMarketplaceSearchProvider.notifier).state = 'weather';
    
    // Set category
    ref.read(obolMarketplaceCategoryProvider.notifier).state = 'Data';
    
    // Set max price ($0.01)
    ref.read(obolMarketplacePriceRangeProvider.notifier).state = 
      (min: 0, max: 1000); // in cents
    
    // Filtered results update automatically
    final filtered = ref.watch(filteredObolServicesProvider);
    
    return filtered.when(
      data: (services) => Text('Found ${services.length} services'),
      loading: () => const CircularProgressIndicator(),
      error: (err, _) => Text('Error: $err'),
    );
  }
}
```

## Step 4: Call the Service API

### Manually call a service:

```dart
class CallServiceButton extends ConsumerWidget {
  const CallServiceButton({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ElevatedButton(
      onPressed: () async {
        final service = ref.read(obolMarketplaceServiceProvider);
        
        try {
          final result = await service.callObolService(
            serviceId: 'weather-api',
            params: {
              'latitude': '40.7128',
              'longitude': '-74.0060',
            },
          );
          
          print('Result: ${result.result}');
          print('Cost: \$${result.cost}');
          print('TX: ${result.arcTxHash}');
          
          // Refresh history
          ref.invalidate(serviceCallHistoryProvider(0));
        } on FriendlyException catch (e) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: ${e.message}')),
          );
        }
      },
      child: const Text('Call Weather API'),
    );
  }
}
```

## Step 5: Display Recent Calls

### Show spending history:

```dart
class RecentCalls extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(serviceCallHistoryProvider(0));
    
    return history.when(
      data: (records) => ListView.builder(
        itemCount: records.length,
        itemBuilder: (context, index) {
          final record = records[index];
          return ListTile(
            title: Text(record.serviceName),
            subtitle: Text('\$${record.cost}'),
            trailing: Text(record.status),
          );
        },
      ),
      loading: () => const CircularProgressIndicator(),
      error: (err, _) => Text('Error: $err'),
    );
  }
}
```

## Step 6: Manage Spending Limits

### Read current limits:

```dart
class LimitsDisplay extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final limits = ref.watch(userAgentLimitsProvider);
    
    return limits.when(
      data: (limit) => Column(
        children: [
          Text('Daily: \$${limit.dailyLimit}'),
          Text('Monthly: \$${limit.monthlyLimit}'),
          Text('Daily Spent: \$${limit.dailySpent}'),
          Text('Daily Remaining: \$${limit.dailyRemaining}'),
        ],
      ),
      loading: () => const CircularProgressIndicator(),
      error: (err, _) => Text('Error: $err'),
    );
  }
}
```

### Refresh limits automatically:

```dart
class AutoRefreshLimits extends ConsumerStatefulWidget {
  @override
  ConsumerState<AutoRefreshLimits> createState() => _AutoRefreshLimitsState();
}

class _AutoRefreshLimitsState extends ConsumerState<AutoRefreshLimits> {
  @override
  void initState() {
    super.initState();
    // Refresh limits every 30 seconds
    Future.delayed(const Duration(seconds: 30), () {
      ref.invalidate(userAgentLimitsProvider);
    });
  }

  @override
  Widget build(BuildContext context) {
    final limits = ref.watch(userAgentLimitsProvider);
    return Text('Daily: \$${limits.whenData((l) => l.dailyLimit)}');
  }
}
```

## Common Patterns

### Error Handling Pattern:

```dart
try {
  final result = await service.callObolService(
    serviceId: serviceId,
    params: params,
  );
  // Success
  showSuccessSnackBar('API call successful');
} on FriendlyException catch (e) {
  // User-friendly error message
  showErrorSnackBar(e.message);
  
  // Log for debugging
  debugPrint('Friendly error: ${e.message}');
  debugPrint('Original error: ${e.original}');
} catch (e) {
  // Unexpected error
  showErrorSnackBar('Unexpected error: $e');
  debugPrint('Unexpected: $e');
}
```

### Real-time Updates Pattern:

```dart
class RealtimeUpdates extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Watch spending (auto-updates when user makes a call)
    final dailySpent = ref.watch(userAgentLimitsProvider)
      .whenData((l) => l.dailySpent);
    
    // Watch loading state
    final isLoading = ref.watch(serviceCallInProgressProvider);
    
    // Watch last error
    final lastError = ref.watch(lastServiceCallErrorProvider);
    
    return Column(
      children: [
        Text('Spent: \$${dailySpent.value ?? "..."}'),
        if (isLoading) const Text('Calling API...'),
        if (lastError != null) Text('Error: $lastError'),
      ],
    );
  }
}
```

### Filtering Pattern:

```dart
class AdvancedFilter extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Apply multiple filters
    ref.read(obolMarketplaceSearchProvider.notifier).state = 'weather';
    ref.read(obolMarketplaceCategoryProvider.notifier).state = 'Data';
    ref.read(obolMarketplacePriceRangeProvider.notifier).state = 
      (min: 0, max: 10000); // max $100
    
    // Get filtered results
    final filtered = ref.watch(filteredObolServicesProvider);
    
    // Clear filters
    void clearFilters() {
      ref.read(obolMarketplaceSearchProvider.notifier).state = '';
      ref.read(obolMarketplaceCategoryProvider.notifier).state = null;
      ref.read(obolMarketplacePriceRangeProvider.notifier).state = 
        (min: 0, max: 100000);
    }
    
    return filtered.when(
      data: (services) => Column(
        children: [
          Text('Found ${services.length} services'),
          ElevatedButton(onPressed: clearFilters, child: const Text('Clear')),
        ],
      ),
      loading: () => const CircularProgressIndicator(),
      error: (err, _) => Text('Error: $err'),
    );
  }
}
```

## Deployment Checklist

- [ ] All 4 screens added to routes
- [ ] Navigation buttons added to wallet
- [ ] Cloud Functions deployed (`firebase deploy --only functions`)
- [ ] Test on device:
  - [ ] Services load
  - [ ] Search/filter works
  - [ ] Can call a service
  - [ ] History displays
  - [ ] Limits show
- [ ] Build APK/IPA
- [ ] Submit to stores

## Testing Locally

### Test the marketplace screen:

```bash
# Hot reload after changes
r

# Full rebuild if needed
R

# Run specific test
flutter test test/wallet/obol_marketplace_test.dart
```

### Debug state:

```dart
// In any ConsumerWidget
final markets = ref.watch(obolMarketplaceProvider);
debugPrint('State: ${markets.toString()}'); // View async state
```

## Environment Setup

### Required env vars (.env or Secret Manager):

```
CIRCLE_API_KEY=sk_...
CIRCLE_ENTITY_SECRET=entity_...
OBOL_API_KEY=obl_sk_live_...
```

### Required Firestore collections:

```
- ObolMarketplaceTransactions
- UserAgentLimits
- AgentLimitChangeLog
```

## Next Steps

1. Read `docs/obol/README.md` for overview
2. Read `docs/obol/FLUTTER_INTEGRATION.md` for full API
3. Run tests in `docs/obol/FLUTTER_TESTING.md`
4. Deploy to staging
5. Run manual test flows
6. Deploy to production

## Common Issues

**Services not loading?**
- Check Cloud Function logs: `firebase functions:log`
- Verify internet connection
- Try pull-to-refresh

**2FA verification fails?**
- Code expires after 30 seconds
- Check system clock is correct
- Try again with new code

**Payments not working?**
- Verify Arc wallet exists
- Check wallet has testnet USDC
- Check daily/monthly limits
- See `FLUTTER_TESTING.md` troubleshooting

## Support

For detailed help, see:
- **Providers API**: `docs/obol/FLUTTER_INTEGRATION.md`
- **Testing Guide**: `docs/obol/FLUTTER_TESTING.md`
- **Troubleshooting**: `docs/obol/FLUTTER_TESTING.md` (end)

---

**Quick Reference:**
- Marketplace screen: `ObolMarketplaceScreen()`
- Detail screen: `ObolServiceDetailScreen(service: service)`
- History screen: `SpendingHistoryScreen()`
- Settings screen: `AgentLimitsSettingsScreen()`
- Service layer: `ObolMarketplaceService()`
- All providers: `lib/wallet/providers/obol_marketplace_provider.dart`
