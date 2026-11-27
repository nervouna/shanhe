# Datasets of the map pipeline

The pipeline downloads these into `data/raw/` (git-ignored) on its first run and reads them from there afterwards. The repository contains none of them, only the map derived from them in `public/data/`. All three licences allow redistributing derived products. Licence pages were read on 2026-11-28.

| Dataset | Used for | Licence |
|---|---|---|
| Natural Earth 1:10m | Borders, coastline, lakes, rivers | Public domain |
| ETOPO 2022, 60 arc-second | Elevation and sea floor | CC0 1.0 |
| Köppen-Geiger maps, Beck et al. 2018 | Climate, from which terrain and vegetation are derived | CC BY 4.0 |

## Natural Earth 1:10m

- **Files**, from `https://naciscdn.org/naturalearth/10m/`:
  - `cultural/ne_10m_admin_0_countries.zip`, version 5.1.1: country borders
  - `cultural/ne_10m_admin_1_states_provinces.zip`, version 5.1.1: first-level administrative borders
  - `physical/ne_10m_land.zip`, version 5.1.1: coastline, as land polygons
  - `physical/ne_10m_lakes.zip`, version 5.0.0: lakes
  - `physical/ne_10m_rivers_lake_centerlines.zip`, version 5.0.0: rivers
- **Site**: https://www.naturalearthdata.com/
- **Licence**: public domain. The terms of use say that all versions of Natural Earth raster and vector map data on the site are in the public domain, that no permission is needed and that crediting the authors is unnecessary.
- **Licence page**: https://www.naturalearthdata.com/about/terms-of-use/
- **Attribution** (not required): Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.

## ETOPO 2022

- **File**: `ETOPO_2022_v1_60s_N90W180_surface.nc`, the 60 arc-second ice-surface elevation with bathymetry, version 1 (2022).
- **Access**: NOAA's OPeNDAP server, `https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc`. The pipeline requests only the window the map needs (22°S to 90°N, 36°E eastwards to 158°W) at every second sample, about 64 MB, in latitude bands stored as `data/raw/etopo/*.dods`.
- **Product page**: https://www.ncei.noaa.gov/products/etopo-global-relief-model
- **Licence**: CC0 1.0. The metadata record says the data are not subject to copyright protection in the United States and that NOAA waives any potential copyright and related rights worldwide through the Creative Commons Zero 1.0 Universal Public Domain Dedication. It also says the data are not to be used for navigation.
- **Licence page**: the "Use Limitation" and "Other Constraints" entries of the metadata record, https://www.ngdc.noaa.gov/metadata/published/NOAA/NESDIS/NGDC/MGG/DEM/iso/xml/etopo_2022.xml
- **Attribution** (the citation the record asks for): NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second Global Relief Model. NOAA National Centers for Environmental Information. https://doi.org/10.25921/fd45-gt74. Accessed 2026-11-28.

## Köppen-Geiger climate classification maps

- **File**: `Beck_KG_V1.zip` (MD5 `69594689d3cdd8323a0f74ce658125a1`), from `https://ndownloader.figshare.com/files/12407516`. The pipeline reads `Beck_KG_V1_present_0p083.tif` from it: the present-day map at 5 arc-minutes.
- **Record**: https://figshare.com/articles/dataset/Present_and_future_K_ppen-Geiger_climate_classification_maps_at_1-km_resolution/6396959, version 2, published 2018-07-16, https://doi.org/10.6084/m9.figshare.6396959
- **Licence**: CC BY 4.0, as stated in the figshare record (read through its API record, https://api.figshare.com/v2/articles/6396959).
- **Licence page**: https://creativecommons.org/licenses/by/4.0/
- **Attribution** (required): Beck, H.E., N.E. Zimmermann, T.R. McVicar, N. Vergopolan, A. Berg, E.F. Wood: Present and future Köppen-Geiger climate classification maps at 1-km resolution, Nature Scientific Data, 2018. Licensed under CC BY 4.0. Changes made: the climate classes are sampled per hex and turned into the terrain and vegetation classes of the game map.
- The attribution is also in `README.md` and `README.zh-CN.md` under "License".

## Not from a dataset

The coordinates of cities, the regions of strategic resources, the volcanoes and the off-map ports in `polities.ts` and `features.ts` are general geographic knowledge written by hand.
