-- An email found by searching the open web (a booking or ordering site, a directory, a news piece), kept only when
-- the page it came from was fetched again and shows both the address and the lead's phone number or postcode.
ALTER TABLE leads ADD COLUMN web_email TEXT;
ALTER TABLE leads ADD COLUMN web_email_url TEXT;
ALTER TABLE leads ADD COLUMN email_search_at TEXT;
