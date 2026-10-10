-- A business's own website found by trying domains made from its name, for listings that link no site.
-- Only kept when the page shows the listing's phone number or postcode.
ALTER TABLE leads ADD COLUMN found_site_url TEXT;
ALTER TABLE leads ADD COLUMN site_search_at TEXT;
