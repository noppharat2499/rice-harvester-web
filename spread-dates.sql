-- กระจายวันที่ซ่อมให้คละกันในช่วงปี 2566-2569 (ค.ศ. 2023-2026)
UPDATE repairs
SET repair_date = DATE '2023-01-05' + ((id * 379) % 1380)::int;
UPDATE vehicles v
SET last_service = (SELECT MAX(repair_date) FROM repairs r WHERE r.vehicle_id = v.id)
WHERE EXISTS (SELECT 1 FROM repairs r WHERE r.vehicle_id = v.id);
