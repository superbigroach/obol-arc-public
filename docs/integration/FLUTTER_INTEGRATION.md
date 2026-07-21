# Obol Marketplace Flutter Integration Guide

## Overview

The Lucilla app integrates with the Obol marketplace, allowing users to discover and call metered APIs with automatic USDC payments on the Arc blockchain. This guide covers the UI, state management, and integration patterns.

## Architecture

### Providers (Riverpod)
Located in: `lib/wallet/providers/obol_marketplace_provider.dart`

**Core Providers:**
- `obolMarketplaceProvider` - Fetches all available services from Obol
- `filteredObolServicesProvider` - Services filtered by search + category + price
- `userAgentLimitsProvider` - User's current spending limits
- `serviceCallHistoryProvider` - Paginated list of past API calls
- `selectedObolServiceProvider` - Currently viewed service (for detail screen)

**Filter Providers:**
- `obolMarketplaceSearchProvider` - Search term
- `obolMarketplaceCategoryProvider` - Selected category filter
- `obolMarketplacePriceRangeProvider` - Max price filter (in cents)
- `callHistoryServiceFilterProvider` - Filter history by service
- `callHistoryDateRangeProvider` - Filter history by date range

**State Providers:**
- `serviceCallInProgressProvider` - Loading state during API calls
- `lastServiceCallErrorProvider` - Last error message
- `obolCategoriesProvider` - Available service categories

### Service Layer
Located in: `lib/wallet/services/obol_marketplace_service.dart`

**Main Methods:**
```dart
// Discover services
Future<List<ObolService>> discoverServices()

// Get user's spending limits
Future<UserAgentLimits> getUserAgentLimits()

// Call a service with payment
Future<ServiceCallResult> callObolService({
  required String serviceId,
  required Map<String, dynamic> params,
  Duration? timeout,
})

// Set spending limits (requires 2FA)
Future<void> setUserAgentLimits({
  required String dailyLimit,
  required String monthlyLimit,
  required List<String> whitelistedServices,
  required String mfaToken,
  String? reason,
})

// Get call history
Future<List<ServiceCallRecord>> getServiceCallHistory({
  int page = 0,
  int pageSize = 20,
  String? serviceFilter,
  DateTime? startDate,
  DateTime? endDate,
})

// Request testnet USDC
Future<void> requestTestnetUsdc()

// Verify 2FA code
Future<String> verify2FA(String code)
```

## UI Screens

### 1. Marketplace Discovery Screen
**File:** `lib/wallet/screens/obol/obol_marketplace_screen.dart`

Shows all available services with search and filtering.

**Features:**
- Search by service name/description
- Filter by category
- Filter by price range (slider)
- Service cards showing: name, category, price, rating, total calls
- Tap to view details

**Usage:**
```dart
Navigator.push(
  context,
  MaterialPageRoute(builder: (_) => const ObolMarketplaceScreen()),
);
```

**Example Flow:**
```
User opens Marketplace
  ↓
Sees list of services (Weather API, Data Query, etc.)
  ↓
Filters by "Data" category
  ↓
Taps "OpenAI Embeddings"
  ↓
Opens detail screen
```

### 2. Service Detail Screen
**File:** `lib/wallet/screens/obol/obol_service_detail_screen.dart`

Detailed view of a single service with ability to call it.

**Features:**
- Service description and documentation link
- Price per call with cost breakdown
- Current spending against daily limit (with warning)
- Input fields for API parameters
- "Buy & Call" button (disabled if limit exceeded)
- Confirmation dialog before calling
- Result display (on same screen via PageView)

**Usage:**
```dart
Navigator.push(
  context,
  MaterialPageRoute(
    builder: (_) => ObolServiceDetailScreen(service: service),
  ),
);
```

**Example: Weather Service Call**
```
Service: OpenWeather API
Price: $0.001 per call
Daily Limit: $50
Daily Spent: $12.50
Daily Remaining: $37.50

Parameters:
  latitude: 40.7128
  longitude: -74.0060
  units: metric

[Buy & Call]
  ↓
Shows confirmation: "Call OpenWeather API ($0.001)? Approve?"
  ↓
User taps Confirm
  ↓
Results displayed:
{
  "temp": 72,
  "humidity": 65,
  "condition": "Partly Cloudy"
}
Cost: $0.001
Transaction: obol_uid_timestamp_xxx
TX Hash: 0x...
```

### 3. Agent Spending Limits Screen
**File:** `lib/wallet/screens/obol/agent_limits_settings_screen.dart`

Configure spending limits and whitelisted services.

**Features:**
- Set daily limit (slider or text input)
- Set monthly limit (slider or text input)
- Whitelist specific services (optional)
- View current spending (today + this month)
- Shows current/remaining amounts
- Requires 2FA to save changes

**Usage:**
```dart
Navigator.push(
  context,
  MaterialPageRoute(
    builder: (_) => const AgentLimitsSettingsScreen(),
  ),
);
```

**Example Flow:**
```
Current Limits:
  Daily: $50.00
  Monthly: $500.00
  Today Spent: $12.50
  This Month Spent: $150.00

User changes:
  Daily: $50 → $100
  Monthly: $500 → $1000
  Whitelisted: All (no whitelist)

Taps [Save Spending Limits]
  ↓
MFA Dialog opens:
  "Enter your password to continue"
  [Password field]
  [Next]
  ↓
"Enter the 6-digit code from your authenticator app"
  [000000 field]
  [Use Biometric] (optional)
  [Verify]
  ↓
Success!
"Spending limits updated successfully"
```

### 4. Spending History Screen
**File:** `lib/wallet/screens/obol/spending_history_screen.dart`

View all past API calls with pagination and filtering.

**Features:**
- Paginated list of all API calls (20 per page)
- Each entry shows: service name, date, cost, status, TX hash
- Filter by service
- Filter by date range
- Tap to expand and see full details (error message if failed)
- Shows success/failed/pending status

**Usage:**
```dart
Navigator.push(
  context,
  MaterialPageRoute(
    builder: (_) => const SpendingHistoryScreen(),
  ),
);
```

**Example History:**
```
Date: 6/29 15:30  OpenWeather API      $0.001  ✓ success
Date: 6/29 14:15  OpenAI Embeddings    $0.025  ✓ success
Date: 6/29 13:45  Data Query Service   $0.010  ✗ failed
                   "Service temporarily unavailable"
Date: 6/29 12:00  OpenWeather API      $0.001  ⏱ pending
```

## Widgets

### Service Call Result Widget
**File:** `lib/wallet/screens/widgets/service_call_result_widget.dart`

Displays API call results with copy/share options.

**Features:**
- Shows success banner with timestamp
- Transaction details (service, cost, TX hash)
- Pretty-printed API result (JSON)
- Copy result to clipboard
- "Call Again" button to reuse same parameters
- "Done" button to return

### MFA Confirm Dialog
**File:** `lib/wallet/screens/widgets/mfa_confirm_dialog.dart`

Two-step confirmation for spending limit changes.

**Features:**
- Step 1: Enter password
- Step 2: Enter 6-digit 2FA code
- Optional: Biometric authentication
- Shows errors and loading state
- Returns MFA token for limit update

## Integrating with Your App

### 1. Add Route to Main App
Edit `lib/main_routes.dart` to add Obol screens:

```dart
GoRoute(
  path: '/wallet/obol/marketplace',
  builder: (context, state) => const ObolMarketplaceScreen(),
),
GoRoute(
  path: '/wallet/obol/history',
  builder: (context, state) => const SpendingHistoryScreen(),
),
GoRoute(
  path: '/wallet/obol/settings',
  builder: (context, state) => const AgentLimitsSettingsScreen(),
),
```

### 2. Add Navigation in Wallet Screen
In your main wallet screen, add buttons to access Obol:

```dart
ListTile(
  title: const Text('Obol Marketplace'),
  subtitle: const Text('Call metered APIs'),
  trailing: const Icon(Icons.arrow_forward),
  onTap: () {
    context.push('/wallet/obol/marketplace');
  },
),
ListTile(
  title: const Text('Spending History'),
  trailing: const Icon(Icons.arrow_forward),
  onTap: () {
    context.push('/wallet/obol/history');
  },
),
ListTile(
  title: const Text('Agent Limits'),
  trailing: const Icon(Icons.arrow_forward),
  onTap: () {
    context.push('/wallet/obol/settings');
  },
),
```

### 3. Handle Real-time Updates
The providers automatically refresh when spending limits change:

```dart
// Refresh user limits in real-time
ref.refresh(userAgentLimitsProvider);

// Refresh marketplace services
ref.refresh(obolMarketplaceProvider);

// Refresh spending history
ref.refresh(serviceCallHistoryProvider(0));
```

## Error Handling

### Common Errors

**Daily limit exceeded**
```
Status: "resource-exhausted"
Message: "Daily limit exceeded. You have $X.XX remaining."
Recovery: Try again tomorrow or increase daily limit in Settings
```

**Service not found**
```
Status: "not-found"
Message: "Service {id} not found on Obol marketplace"
Recovery: Service may be deprecated; check marketplace for available services
```

**Arc wallet not found**
```
Status: "failed-precondition"
Message: "Arc wallet not found. Please create one in the app settings."
Recovery: Create Arc wallet first via Circle Modular Wallets setup
```

**2FA verification failed**
```
Status: "failed-precondition"
Message: "Invalid 2FA code"
Recovery: Check that code hasn't expired (usually 30 seconds) and try again
```

**API call failed**
```
Status: "internal"
Message: "API call failed on Obol side"
Recovery: Try again later; check service documentation link
```

### All Error Types
The `FriendlyException` class in `obol_marketplace_service.dart` converts technical errors to user-friendly messages:

```dart
try {
  final result = await service.callObolService(
    serviceId: 'weather-api',
    params: {'lat': '40.7', 'lon': '-74.0'},
  );
} on FriendlyException catch (e) {
  // User-friendly error message
  showSnackBar(e.message);
} catch (e) {
  // Unexpected error
  debugPrint('Unexpected: $e');
}
```

## Testing on Testnet

### Setup
1. Create a test Arc wallet (via Modular Wallets in app)
2. Request testnet USDC via the app or dashboard
3. Set LOW spending limits for testing:
   - Daily: $0.10
   - Monthly: $1.00

### Test Flow
```dart
// 1. Discover services
final services = await service.discoverServices();
print('Found ${services.length} services');

// 2. Get limits
final limits = await service.getUserAgentLimits();
print('Daily limit: ${limits.dailyLimit}');

// 3. Call a cheap service
final result = await service.callObolService(
  serviceId: 'weather-api',
  params: {'lat': '40.7128', 'lon': '-74.0060'},
);
print('Result: ${result.result}');
print('Cost: ${result.cost}');
print('TX Hash: ${result.arcTxHash}');

// 4. Check history
final history = await service.getServiceCallHistory();
print('${history.length} calls in history');

// 5. Verify cost was recorded
final updatedLimits = await service.getUserAgentLimits();
print('Spent today: ${updatedLimits.dailySpent}');
```

### Debugging

**Enable detailed logging:**
```dart
// In main.dart
void main() {
  // Enable debug logging for Obol service
  debugPrintBeginFrame = true;
  debugPrint('[ObolMarketplaceService] initialized');
}
```

**Check transaction status:**
```dart
// Get history to see transaction details
final history = await service.getServiceCallHistory();
for (final record in history) {
  print('${record.serviceName}: ${record.status}');
  if (record.errorMessage != null) {
    print('  Error: ${record.errorMessage}');
  }
  if (record.arcTxHash != null) {
    print('  TX: ${record.arcTxHash}');
  }
}
```

## Data Models

### ObolService
```dart
class ObolService {
  final String id;                    // Marketplace service ID
  final String name;                  // "Weather API", "OpenAI Embeddings"
  final String category;              // "Weather", "AI", "Data"
  final String description;           // "Get weather data..."
  final String pricePerCall;          // "0.001" (USDC)
  final String callUrl;               // Obol API endpoint
  final String documentationUrl;      // Link to docs
  final double rating;                // 4.5/5.0
  final int totalCalls;              // Total calls made
  final bool isActive;               // Is service available
}
```

### UserAgentLimits
```dart
class UserAgentLimits {
  final String dailyLimit;            // "50.00" (USDC)
  final String monthlyLimit;          // "500.00" (USDC)
  final List<String> whitelistedServices; // [] = all allowed
  final String dailySpent;            // "12.50" (USDC)
  final String monthlySpent;          // "150.00" (USDC)
  final DateTime lastUpdated;
  
  // Computed properties
  String get dailyRemaining;          // "37.50"
  String get monthlyRemaining;        // "350.00"
}
```

### ServiceCallRecord
```dart
class ServiceCallRecord {
  final String id;                    // obol_uid_timestamp_xxx
  final String serviceId;
  final String serviceName;
  final String cost;                  // "0.001" (USDC)
  final String status;                // 'success' | 'failed' | 'pending_settlement'
  final DateTime timestamp;
  final String? arcTxHash;            // "0x..."
  final String? errorMessage;
  final dynamic apiResult;            // Raw API response
}
```

### ServiceCallResult
```dart
class ServiceCallResult {
  final dynamic result;               // API result
  final String cost;                  // "0.001" (USDC)
  final String transactionId;         // obol_uid_timestamp_xxx
  final String? arcTxHash;            // "0x..."
  final DateTime timestamp;
}
```

## Spending Limits & Security

### Default Limits
- Daily: $50.00 USDC
- Monthly: $500.00 USDC
- Whitelist: Empty (all services allowed)

### Limit Enforcement
1. **Before API call**: Check that cost <= remaining daily limit
2. **On success**: Deduct cost from dailySpent + monthlySpent
3. **On failure**: Do NOT deduct (user wasn't charged)

### 2FA Protection
Changing limits requires:
1. Password verification
2. 2FA code (6-digit code from authenticator app)
3. Biometric auth (optional, planned)

**Audit Trail:** Every limit change is logged with:
- User ID
- Old limits vs new limits
- Timestamp
- IP address
- 2FA status

## Performance Tips

1. **Cache services list** - Don't refresh unless user pulls to refresh
2. **Lazy load history** - Use pagination (20 items/page)
3. **Debounce search** - Wait 300ms after user stops typing
4. **Preload next page** - Start fetching page 2 when viewing page 1

## Future Enhancements

- [ ] Biometric authentication for 2FA
- [ ] Batch API calls to reduce gas costs
- [ ] Service usage analytics dashboard
- [ ] Scheduled/recurring API calls
- [ ] API call templates (save favorite parameters)
- [ ] Service ratings & reviews
- [ ] Webhook integrations (call services on events)
- [ ] Advanced rate limiting per service

## Support

For issues or questions:
1. Check Cloud Function logs: `firebase functions:log`
2. Look at service call history for error details
3. Review `docs/obol/README.md` for backend architecture
4. Contact support with transaction ID from history

## References

- **Obol Docs**: https://obol.tech/docs
- **Arc Blockchain**: https://arc.io
- **Circle Modular Wallets**: [Circle SDK docs]
- **USDC on Arc**: EIP-3009 transferWithAuthorization support

---

**Last Updated**: June 29, 2026  
**Status**: Production Ready  
**Nanopayment Fees**: ~$0.0000001 USDC per call (batched)
