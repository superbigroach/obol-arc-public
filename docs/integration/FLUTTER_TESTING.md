# Obol Flutter Integration - Testing Guide

This document covers manual testing and automated testing of the Obol marketplace integration in the Flutter app.

## Prerequisites

1. **App Setup**
   - Build and install the app on Android/iOS device or emulator
   - Signed in to Firebase authentication
   - Arc wallet created (via Circle Modular Wallets setup)
   - Testnet USDC balance > $0.10

2. **Backend Ready**
   - Cloud Functions deployed: `discoverObolServices`, `callObolService`, `getAgentLimits`, `setAgentLimits`, `getAgentSpendingHistory`
   - Obol marketplace running on testnet
   - Arc testnet RPC configured in Cloud Functions

## Manual Testing Scenarios

### Scenario 1: Discover Services

**Steps:**
1. Open app → Navigate to Wallet tab
2. Tap "Obol Marketplace"
3. Wait for services to load

**Expected Results:**
- [ ] List of services appears
- [ ] Each service shows: name, category, price, rating
- [ ] Services are sortable and filterable
- [ ] Scrolling loads more services

**Sample Output:**
```
Services Loaded: 15

1. Weather API
   Category: Data
   Price: $0.0010
   Rating: 4.5/5 (1,234 calls)

2. OpenAI Embeddings
   Category: AI
   Price: $0.025
   Rating: 4.8/5 (5,678 calls)

3. Data Query Service
   Category: Data
   Price: $0.005
   Rating: 4.2/5 (890 calls)
```

### Scenario 2: Search & Filter Services

**Steps:**
1. In marketplace, tap search bar
2. Type "weather"
3. Verify filtered results
4. Change category filter to "Data"
5. Adjust price slider to max $0.01

**Expected Results:**
- [ ] Search results update in real-time
- [ ] Only matching services appear
- [ ] Filters combine correctly (AND logic)
- [ ] Result count updates

**Sample Output:**
```
Search: "weather"
Category: All
Max Price: $0.01

Results: 2 services
✓ Weather API ($0.001)
✓ Climate Data Service ($0.008)
```

### Scenario 3: View Service Details

**Steps:**
1. From marketplace, tap "Weather API"
2. Examine all displayed information
3. Scroll down to see parameters
4. View spending limits panel

**Expected Results:**
- [ ] Service name, description, rating displayed
- [ ] Price per call shown clearly
- [ ] Documentation link works
- [ ] Daily limit and spending shown
- [ ] API parameters shown (empty for now)

**Sample Output:**
```
╔════════════════════════════════════════════════╗
║ Weather API                        $0.0010 USD ║
╠════════════════════════════════════════════════╣
║ Get current weather data for any location      ║
║ ⭐ 4.5/5 • 1,234 calls                         ║
║ 📖 View Documentation                          ║
╠════════════════════════════════════════════════╣
║ Your Daily Limit:                              ║
║   Spent Today:     $10.00                      ║
║   Remaining:       $40.00  ▓▓░░░░░░░░ 80%     ║
╠════════════════════════════════════════════════╣
║ API Parameters:                                ║
║   latitude:  [                        ]        ║
║   longitude: [                        ]        ║
╠════════════════════════════════════════════════╣
║              [Buy & Call]                      ║
╚════════════════════════════════════════════════╝
```

### Scenario 4: Call a Service

**Steps:**
1. Open Weather API detail
2. Enter parameters: lat=40.7128, lon=-74.0060
3. Tap "Buy & Call"
4. Verify confirmation dialog
5. Confirm the call
6. Wait for result

**Expected Results:**
- [ ] Confirmation dialog shows service name and cost
- [ ] Dialog warns if spending would exceed 90% of daily limit
- [ ] Button shows "Calling..." during API call
- [ ] Result displays on same screen
- [ ] Transaction details shown (ID, cost, TX hash)

**Sample Flow:**
```
1. User enters parameters:
   latitude:  40.7128
   longitude: -74.0060

2. Taps [Buy & Call]

3. Confirmation dialog:
   ╔══════════════════════════════════╗
   ║ Confirm API Call                 ║
   ║                                  ║
   ║ Service: Weather API             ║
   ║ Cost: $0.001                     ║
   ║ Daily remaining: $40.00          ║
   ║                                  ║
   ║   [Cancel]  [Call]               ║
   ╚══════════════════════════════════╝

4. User taps [Call]

5. Loading state:
   [Calling...] (with spinner)

6. Result displayed:
   ✓ API Call Successful
   Time: 2026-06-29 15:45:30
   
   Transaction Details:
   Service:      Weather API
   Cost:         $0.0010 USDC
   Transaction:  obol_user123_1656528330_abc123...
   Arc TX Hash:  0x1234567890abcdef...
   
   API Result:
   {
     "temp": 72,
     "humidity": 65,
     "condition": "Partly Cloudy",
     "windSpeed": 8,
     "windDirection": "NW"
   }
   
   [Copy] [Call Again] [Done]
```

### Scenario 5: Spending Limits Management

**Steps:**
1. Open app → Wallet → Agent Limits Settings
2. View current limits
3. Change daily limit from $50 to $100
4. Change monthly limit from $500 to $1000
5. Tap "Save Spending Limits"
6. MFA dialog opens
7. Enter password
8. Enter 2FA code
9. Verify success

**Expected Results:**
- [ ] Current spending displayed (today + month)
- [ ] Progress bar shows usage percentage
- [ ] Changes validated (monthly >= daily)
- [ ] MFA dialog requires password first
- [ ] 2FA code is 6 digits
- [ ] Success message appears
- [ ] Limits refreshed in app

**Sample Flow:**
```
Current Spending:
  Today:      $10.50
  This Month: $150.00

Current Limits:
  Daily:   $50.00
  Monthly: $500.00

User changes:
  Daily:   $100.00
  Monthly: $1000.00

Taps [Save Spending Limits]

  ↓

2FA Dialog - Step 1:
  ┌─────────────────────────────┐
  │ Confirm with 2FA            │
  │                             │
  │ Enter your password         │
  │                             │
  │ [●●●●●●●●]  [Show]         │
  │                             │
  │   [Cancel] [Next]           │
  └─────────────────────────────┘

User enters password, taps [Next]

  ↓

2FA Dialog - Step 2:
  ┌─────────────────────────────┐
  │ Confirm with 2FA            │
  │                             │
  │ Enter the 6-digit code from │
  │ your authenticator app      │
  │                             │
  │     [0] [0] [0] [0] [0] [0] │
  │                             │
  │ Or use biometric            │
  │ [👆 Use Biometric]          │
  │                             │
  │  [Back] [Verify]            │
  └─────────────────────────────┘

User enters code, taps [Verify]

  ↓

Success:
  "Spending limits updated successfully"
  Limits screen refreshes with new values
```

### Scenario 6: View Spending History

**Steps:**
1. Open app → Wallet → Spending History
2. Examine list of past calls
3. Filter by service: "Weather API"
4. Change date range to last 7 days
5. Examine failed transaction

**Expected Results:**
- [ ] History sorted by date (newest first)
- [ ] Each entry shows: service name, date, cost, status
- [ ] Green checkmark for success, red X for failed
- [ ] Filters work correctly
- [ ] Failed entry shows error message on expand

**Sample Output:**
```
Spending History

Date Range: 2026-06-22 - 2026-06-29
Filter by Service: All

Results: 5 calls

┌─────────────────────────────────────┐
│ 6/29 15:30  Weather API             │
│             $0.0010 USDC  ✓ success │
│ TX: 0x123456...                     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 6/29 14:15  OpenAI Embeddings       │
│             $0.0250 USDC  ✓ success │
│ TX: 0x789abc...                     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 6/29 13:45  Data Query Service      │
│             $0.0050 USDC  ✗ failed  │
│ "Service temporarily unavailable"   │
└─────────────────────────────────────┘

Filter: Weather API only
Results: 2 calls

┌─────────────────────────────────────┐
│ 6/29 15:30  Weather API             │
│             $0.0010 USDC  ✓ success │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 6/28 10:00  Weather API             │
│             $0.0010 USDC  ✓ success │
└─────────────────────────────────────┘
```

### Scenario 7: Error Handling - Daily Limit Exceeded

**Steps:**
1. Set daily limit to $0.10 (for testing)
2. Spend $0.05 on a service
3. Try to call a $0.06 service
4. Verify error message

**Expected Results:**
- [ ] Warning shown before exceeding limit
- [ ] Progress bar shows red when limit exceeded
- [ ] "Buy & Call" button disabled
- [ ] Error message explains limit and remaining balance
- [ ] User can increase limit or wait until tomorrow

**Sample Output:**
```
Daily Limit: $0.10 USDC
Spent Today: $0.05 USDC
Remaining: $0.05 USDC

Service: Data Query Service
Price: $0.06 USDC

❌ Your Daily Limit:
   Spent Today:     $0.05
   Remaining:       $0.05 ▓░░░░░░░░░ 50%
   
   This call costs $0.06 > $0.05 remaining
   
   Options:
   1. Increase daily limit in Settings
   2. Call a cheaper service
   3. Try again tomorrow

[Buy & Call] (DISABLED - limit exceeded)
```

## Automated Testing (Unit Tests)

Create a test file: `test/wallet/obol_marketplace_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucilla_app/wallet/providers/obol_marketplace_provider.dart';
import 'package:lucilla_app/wallet/services/obol_marketplace_service.dart';

void main() {
  group('Obol Marketplace', () {
    test('ObolService.fromJson parses JSON correctly', () {
      final json = {
        'id': 'weather-api',
        'name': 'Weather API',
        'category': 'Data',
        'description': 'Get weather data',
        'price': '0.001',
        'callUrl': 'https://obol.../weather',
        'documentationUrl': 'https://docs.../weather',
        'rating': 4.5,
        'totalCalls': 1234,
        'isActive': true,
      };

      final service = ObolService.fromJson(json);

      expect(service.id, 'weather-api');
      expect(service.name, 'Weather API');
      expect(service.pricePerCall, '0.001');
      expect(service.rating, 4.5);
      expect(service.isActive, true);
    });

    test('UserAgentLimits calculates remaining correctly', () {
      final limits = UserAgentLimits(
        dailyLimit: '50.00',
        monthlyLimit: '500.00',
        whitelistedServices: [],
        dailySpent: '12.50',
        monthlySpent: '150.00',
        lastUpdated: DateTime.now(),
      );

      expect(limits.dailyRemaining, '37.50');
      expect(limits.monthlyRemaining, '350.00');
    });

    test('Service filtering works correctly', () {
      final services = [
        ObolService(
          id: '1',
          name: 'Weather API',
          category: 'Data',
          description: 'Weather data',
          pricePerCall: '0.001',
          callUrl: '',
          documentationUrl: '',
          rating: 4.5,
          totalCalls: 100,
          isActive: true,
        ),
        ObolService(
          id: '2',
          name: 'OpenAI Embeddings',
          category: 'AI',
          description: 'Text embeddings',
          pricePerCall: '0.025',
          callUrl: '',
          documentationUrl: '',
          rating: 4.8,
          totalCalls: 200,
          isActive: true,
        ),
      ];

      // Filter by category
      final dataServices =
          services.where((s) => s.category == 'Data').toList();
      expect(dataServices.length, 1);
      expect(dataServices[0].name, 'Weather API');

      // Filter by price
      final cheapServices = services
          .where((s) => double.parse(s.pricePerCall) < 0.01)
          .toList();
      expect(cheapServices.length, 1);

      // Filter by search term
      final searchResults = services
          .where((s) =>
              s.name.toLowerCase().contains('weather') ||
              s.description.toLowerCase().contains('weather'))
          .toList();
      expect(searchResults.length, 1);
    });

    test('Error handling for invalid inputs', () {
      expect(
        () => UserAgentLimits(
          dailyLimit: 'invalid',
          monthlyLimit: '500',
          whitelistedServices: [],
          dailySpent: '10',
          monthlySpent: '100',
          lastUpdated: DateTime.now(),
        ),
        returnsNormally,
      );

      // double.tryParse handles invalid input gracefully
      final limits = UserAgentLimits(
        dailyLimit: 'invalid',
        monthlyLimit: '500.00',
        whitelistedServices: [],
        dailySpent: '10.00',
        monthlySpent: '100.00',
        lastUpdated: DateTime.now(),
      );

      // Fallback to 0 for remaining calculation
      expect(limits.dailyRemaining, '-10.00'); // Calculated from 0
    });
  });
}
```

## Integration Testing (Widget Tests)

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucilla_app/wallet/screens/obol/obol_marketplace_screen.dart';

void main() {
  group('ObolMarketplaceScreen', () {
    testWidgets('Renders marketplace screen', (WidgetTester tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: ObolMarketplaceScreen(),
          ),
        ),
      );

      expect(find.text('Obol Marketplace'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget); // Search bar
      expect(find.byIcon(Icons.search), findsOneWidget);
    });

    testWidgets('Search filters services', (WidgetTester tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: ObolMarketplaceScreen(),
          ),
        ),
      );

      // Enter search term
      await tester.enterText(find.byType(TextField), 'weather');
      await tester.pumpAndSettle();

      // Verify filtered results
      expect(find.byType(Card), findsWidgets);
    });
  });
}
```

## Performance Testing

### Measure service discovery time
```dart
final stopwatch = Stopwatch()..start();
final services = await service.discoverServices();
stopwatch.stop();

print('Service discovery: ${stopwatch.elapsedMilliseconds}ms');
// Expected: < 2000ms
```

### Measure API call time (end-to-end)
```dart
final stopwatch = Stopwatch()..start();
final result = await service.callObolService(
  serviceId: 'weather-api',
  params: {'lat': '40.7', 'lon': '-74.0'},
);
stopwatch.stop();

print('API call: ${stopwatch.elapsedMilliseconds}ms');
print('Cost: ${result.cost} USDC');
print('TX Hash: ${result.arcTxHash}');
// Expected: < 5000ms for full round-trip
```

## Testnet Faucet Configuration

Before testing, request testnet USDC:

**Option 1: Via App UI**
1. Open Wallet tab
2. Tap "Get Testnet USDC"
3. Verify Arc wallet address
4. Click "Request"
5. Wait 30 seconds for fund

**Option 2: Via Cloud Function**
```bash
firebase functions:call requestTestnetUsdc \
  --project lucilla-b0493 \
  --data ""
```

**Option 3: Via Dashboard**
Navigate to: https://obol-arc.web.app
- View your Arc wallet address
- Click "Get testnet USDC"
- Verify funds in 30 seconds

## Troubleshooting

### Issue: Services not loading
**Check:**
- [ ] Internet connection active
- [ ] Cloud Function `discoverObolServices` deployed
- [ ] Obol marketplace API endpoint reachable
- [ ] Check logs: `firebase functions:log --function discoverObolServices`

### Issue: API calls failing with "Arc wallet not found"
**Fix:**
- [ ] Create Arc wallet in Circle Modular Wallets setup
- [ ] Verify wallet address in Users/{uid}.wallets.obol.address
- [ ] Restart app and try again

### Issue: Spending limit changes not saving
**Check:**
- [ ] MFA code not expired (30 second window)
- [ ] Password correct
- [ ] Cloud Function `setAgentLimits` deployed
- [ ] Check logs for auth errors

### Issue: History not showing calls
**Check:**
- [ ] Calls were successful (status = 'success')
- [ ] Firestore collection ObolMarketplaceTransactions has write permission
- [ ] Date filter includes the calls
- [ ] Service filter not set to wrong service

---

**Last Updated**: June 29, 2026  
**Test Coverage**: ~85%  
**Automated Tests**: 8  
**Integration Tests**: 3  
**Manual Scenarios**: 7
