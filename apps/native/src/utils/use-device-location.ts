import { useEffect, useState } from "react";
import * as Location from "expo-location";

export type DeviceLocation = {
  lat: number;
  lng: number;
  address?: string;
} | null;

/**
 * Captures the device's current GPS position (once per mount) and reverse-geocodes
 * it to a readable address on-device. The result is sent with each chat request so
 * the assistant's `getCurrentLocation` / `getWeather` tools have real coordinates.
 *
 * Permission is requested lazily; if denied, returns null and the assistant falls
 * back to asking the user for the site.
 */
export function useDeviceLocation(): DeviceLocation {
  const [location, setLocation] = useState<DeviceLocation>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        let address: string | undefined;
        try {
          const [geo] = await Location.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          if (geo) {
            address =
              [geo.name ?? geo.street, geo.city, geo.region]
                .filter(Boolean)
                .join(", ") || undefined;
          }
        } catch {
          /* reverse geocode is best-effort */
        }
        if (!cancelled) {
          setLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            address,
          });
        }
      } catch {
        /* location unavailable — assistant will ask for the site */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return location;
}
