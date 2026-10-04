"""Small geographic helpers for map-scale well comparisons."""

from math import asin, cos, degrees, radians, sin, sqrt

EARTH_RADIUS_KM = 6371.0088


def coordinate_bounds_within_radius(
    latitude: float, longitude: float, radius_km: float
) -> tuple[float, float, list[tuple[float, float]]]:
    """Return an inclusive lat/lon bounding box for an exact Haversine search.

    Database filtering uses these bounds to reduce candidates before applying the
    precise distance calculation. Longitude intervals split at the antimeridian.
    """
    angular_distance = min(radius_km / EARTH_RADIUS_KM, radians(180))
    latitude_radians = radians(latitude)
    latitude_delta = degrees(angular_distance)
    minimum_latitude = max(-90.0, latitude - latitude_delta)
    maximum_latitude = min(90.0, latitude + latitude_delta)

    if minimum_latitude <= -90.0 or maximum_latitude >= 90.0:
        return minimum_latitude, maximum_latitude, [(-180.0, 180.0)]

    longitude_ratio = sin(angular_distance) / cos(latitude_radians)
    if abs(longitude_ratio) >= 1.0:
        return minimum_latitude, maximum_latitude, [(-180.0, 180.0)]

    longitude_delta = degrees(asin(longitude_ratio))
    minimum_longitude = longitude - longitude_delta
    maximum_longitude = longitude + longitude_delta
    if minimum_longitude < -180.0:
        intervals = [(minimum_longitude + 360.0, 180.0), (-180.0, maximum_longitude)]
    elif maximum_longitude > 180.0:
        intervals = [(minimum_longitude, 180.0), (-180.0, maximum_longitude - 360.0)]
    else:
        intervals = [(minimum_longitude, maximum_longitude)]
    return minimum_latitude, maximum_latitude, intervals


def haversine_distance_km(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    lat_a, lat_b = radians(latitude_a), radians(latitude_b)
    delta_lat = radians(latitude_b - latitude_a)
    delta_lon = radians(longitude_b - longitude_a)
    haversine = sin(delta_lat / 2) ** 2 + cos(lat_a) * cos(lat_b) * sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(min(1.0, haversine)))
