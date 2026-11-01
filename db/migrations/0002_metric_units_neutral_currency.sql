-- 0.4.0: canonical quantities become metric and money fields lose their
-- currency suffix (amounts are in the deployment currency, NEXUS_CURRENCY).
--
--   Shipment.weightLbs     -> weightKg      (x 0.45359237, 1 decimal)
--   Shipment.distanceMiles -> distanceKm    (x 1.609344, 1 decimal)
--   Route.distanceMiles    -> distanceKm    (x 1.609344, 1 decimal)
--   Vehicle.capacityLbs    -> capacityKg    (x 0.45359237, 1 decimal)
--   Policy.maxCostUsd      -> maxCost       (value kept)
--   Approval.estimatedCostUsd            -> estimatedCost (value kept)
--   AgentRun.plan.options[].estimatedCostUsd -> estimatedCost (value kept)
--
-- Money values are NOT converted between currencies: an exchange rate is a
-- business decision, not a migration. Databases holding only the old Texas
-- demo set should be re-seeded instead: `npm run db:seed -- --force`.
-- Historical records (agent action outputs, communications, audit) are left
-- exactly as they were written. Every statement is idempotent.

UPDATE shipments
SET data = (data - 'weightLbs' - 'distanceMiles')
  || jsonb_build_object(
       'weightKg', round((data->>'weightLbs')::numeric * 0.45359237, 1),
       'distanceKm', round((data->>'distanceMiles')::numeric * 1.609344, 1))
WHERE data ? 'weightLbs' AND data ? 'distanceMiles';

UPDATE routes
SET data = (data - 'distanceMiles')
  || jsonb_build_object('distanceKm', round((data->>'distanceMiles')::numeric * 1.609344, 1))
WHERE data ? 'distanceMiles';

UPDATE vehicles
SET data = (data - 'capacityLbs')
  || jsonb_build_object('capacityKg', round((data->>'capacityLbs')::numeric * 0.45359237, 1))
WHERE data ? 'capacityLbs';

UPDATE policies
SET data = (data - 'maxCostUsd') || jsonb_build_object('maxCost', data->'maxCostUsd')
WHERE data ? 'maxCostUsd';

UPDATE approvals
SET data = (data - 'estimatedCostUsd') || jsonb_build_object('estimatedCost', data->'estimatedCostUsd')
WHERE data ? 'estimatedCostUsd';

UPDATE agent_runs
SET data = jsonb_set(
  data,
  '{plan,options}',
  (
    SELECT coalesce(jsonb_agg(
             CASE WHEN o ? 'estimatedCostUsd'
                  THEN (o - 'estimatedCostUsd') || jsonb_build_object('estimatedCost', o->'estimatedCostUsd')
                  ELSE o END
             ORDER BY i), '[]'::jsonb)
    FROM jsonb_array_elements(data->'plan'->'options') WITH ORDINALITY AS t(o, i)
  ))
WHERE jsonb_typeof(data->'plan'->'options') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(data->'plan'->'options') AS x(o) WHERE o ? 'estimatedCostUsd');
