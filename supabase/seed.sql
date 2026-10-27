WITH desired(zone_group, name, sort_order) AS (
  VALUES
    ('Student halls and hostels', 'Akenzua Hall', 1),
    ('Student halls and hostels', 'Amina Hall', 2),
    ('Student halls and hostels', 'Alexander Hall', 3),
    ('Student halls and hostels', 'Danfodio Hall', 4),
    ('Student halls and hostels', 'ICSA Hall', 5),
    ('Student halls and hostels', 'Ramat Hall', 6),
    ('Student halls and hostels', 'Ribadu Hall', 7),
    ('Student halls and hostels', 'Suleiman Hall', 8),
    ('Student halls and hostels', 'Shehu Idris Hall', 9),
    ('Student halls and hostels', 'Aliko Dangote Hall', 10),
    ('Gates and access points', 'ABU North Gate', 11),
    ('Gates and access points', 'ABU Main Gate', 12),
    ('Gates and access points', 'Phase II / Site II entrance', 13),
    ('Markets and commercial centres', 'ABU Community Market', 14),
    ('Markets and commercial centres', 'Samaru Market-side campus access', 15),
    ('Markets and commercial centres', 'Community Market Junction', 16),
    ('Markets and commercial centres', 'Hall shopping complexes and minimarkets', 17),
    ('Markets and commercial centres', 'North Gate shops and business area', 18),
    ('Markets and commercial centres', 'Main Gate commercial area', 19),
    ('Markets and commercial centres', 'Campus kiosks and food vendors area', 20),
    ('Student service centres and landmarks', 'Aliyu Mustapha Social Centre', 21),
    ('Student service centres and landmarks', 'Pharmacy Roundabout', 22),
    ('Student service centres and landmarks', 'Kashim Ibrahim Library area', 23),
    ('Student service centres and landmarks', 'ABU Bookshop', 24),
    ('Student service centres and landmarks', 'Central Mosque / Main Gate area', 25),
    ('Student service centres and landmarks', 'ABU Post Office area', 26),
    ('Student service centres and landmarks', 'Senate Building area', 27),
    ('Student service centres and landmarks', 'Students'' clinic / campus medical centre', 28),
    ('Student service centres and landmarks', 'Faculty of Engineering area', 29),
    ('Student service centres and landmarks', 'Postgraduate School / postgraduate accommodation area', 30)
), seeded_zones AS (
  INSERT INTO public.pilot_service_zones (zone_group, name, sort_order, is_active)
  SELECT zone_group, name, sort_order, true FROM desired
  ON CONFLICT (name) DO NOTHING
  RETURNING name, sort_order
), seeded_contact AS (
  INSERT INTO public.fixmate_contact_settings (id, support_whatsapp_number)
  VALUES (1, '08144196124')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
SELECT z.name, z.sort_order, (SELECT count(*) FROM seeded_contact) AS contact_rows_added
FROM public.pilot_service_zones z
JOIN desired d ON d.name = z.name
ORDER BY z.sort_order
LIMIT 30;
