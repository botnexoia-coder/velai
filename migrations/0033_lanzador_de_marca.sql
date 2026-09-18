-- Lanzador de marca del widget (v15). NULL = defaults del widget.
ALTER TABLE tenants ADD COLUMN portrait_url TEXT;
ALTER TABLE tenants ADD COLUMN accent_color TEXT;
ALTER TABLE tenants ADD COLUMN teaser_title TEXT;
ALTER TABLE tenants ADD COLUMN teaser_copy TEXT;
ALTER TABLE tenants ADD COLUMN teaser_title_en TEXT;
ALTER TABLE tenants ADD COLUMN teaser_copy_en TEXT;
