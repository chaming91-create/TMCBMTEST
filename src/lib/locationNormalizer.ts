const clean=(value:unknown)=>value==null?'':String(value).trim();
export function normalizeTmUnit(value:unknown){const raw=clean(value);if(!raw)return'';if(/^m\d+$/i.test(raw))return String(Number(raw.slice(1)));if(/^\d+$/.test(raw))return String(Number(raw));return raw;}
export function normalizeCarNumber(trainValue:unknown,carValue:unknown){const train=clean(trainValue),car=clean(carValue);if(!car)return'';if(/^\d{3}$/.test(train)&&/^\d{4}$/.test(car)&&`${car[0]}${car.slice(2)}`===train)return car[1];return car;}
