# Generic adapter example (proof of the seam)

No Senor Tech system name was supplied, so this directory is a **generic
REST + CSV adapter** driven by `mapping.json`. It proves that a legacy
export can be read (never written), mapped to NEXUS's canonical
`Shipment` / `Driver` / `Vehicle` / `Facility` types, and reconciled
against the canonical store. It is not a real Senor system.

- `mapping.json` — one entry per canonical entity: where the data comes
  from (`csv` file or `rest` endpoint, GET only), which source column is
  the source id, and how each canonical field is derived (`from`,
  `template`, `const`, `map`, `transform`, nested `object`).
- `*.csv` — legacy-style extracts generated from the demo seed with
  Australian-flavoured column names and metric units, plus deliberate
  anomalies: a duplicated consignment row, a second row for the hero
  consignment with a different driver, a consignment NEXUS does not know
  (`9999`), a row with a blank consignee and an unmapped status, and a
  driver with an unparsable latitude.

Run the reconciliation report:

```bash
npm run reconcile -- --mapping adapters/generic/mapping.json
npm run reconcile -- --mapping adapters/generic/mapping.json --entity shipment --out /tmp/report.json
```

For a real system, copy this directory, point `source` at the export or
endpoint, and adjust the field rules. The adapter has no write path.
