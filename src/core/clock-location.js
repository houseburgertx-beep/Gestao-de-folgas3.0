export function createClockLocationReader(geolocation, options = {}) {
  const maxAge = options.maxAge ?? 30000;
  const timeout = options.timeout ?? 12000;
  const fallbackDelay = options.fallbackDelay ?? 1200;
  const settleDelay = options.settleDelay ?? 2500;
  let cached = null, pending = null;
  const valid = (position) => {
    const c = position?.coords;
    return c && Number.isFinite(c.latitude) && Math.abs(c.latitude) <= 90 &&
      Number.isFinite(c.longitude) && Math.abs(c.longitude) <= 180 &&
      Number.isFinite(c.accuracy) && c.accuracy >= 0 && c.accuracy <= 5000 &&
      Number.isFinite(position.timestamp) && Date.now() - position.timestamp <= maxAge && position.timestamp <= Date.now() + 5000;
  };
  const denied = (message, reason = 'permission') => Object.assign(new Error(message), {code:1,locationReason:reason});
  const permissionState = async () => {
    if (!options.permissions?.query) return 'unknown';
    let timer;
    try {return await Promise.race([Promise.resolve().then(()=>options.permissions.query({name:'geolocation'})).then(p=>p.state),new Promise(resolve=>{timer=setTimeout(()=>resolve('unknown'),400);})]);}
    catch {return 'unknown';}finally{clearTimeout(timer);}
  };
  const read = function read({fresh = false} = {}) {
    if (fresh) cached = null;
    if (valid(cached)) return Promise.resolve(cached);
    if (pending) return pending;
    if (options.secureContext === false) return Promise.reject(denied('Abra o aplicativo pelo endereço HTTPS oficial para usar a localização.','insecure'));
    if (options.allowedByPolicy?.() === false) return Promise.reject(denied('Este navegador interno bloqueia a localização. Abra o aplicativo diretamente no Safari ou Chrome.','policy'));
    if (!geolocation) return Promise.reject(new Error('Este aparelho não disponibiliza localização.'));
    pending = new Promise((resolve,reject) => {
      let done=false,best=null,watchId,lastError,permissionChecked=false,permissionRecovery=false,settledEnough=false;
      const finish=(error,position)=>{
        if(done)return;
        done=true;clearTimeout(hardTimer);clearTimeout(fallbackTimer);clearTimeout(settleTimer);
        if(watchId!==undefined)geolocation.clearWatch?.(watchId);
        if(error)reject(error);else{cached=position;resolve(position);}
      };
      const onPosition=position=>{
        if(done||!valid(position))return;
        if(!best||position.coords.accuracy<best.coords.accuracy||position.coords.accuracy===best.coords.accuracy&&position.timestamp>best.timestamp)best=position;
        if(best.coords.accuracy<=100||settledEnough&&best.coords.accuracy<=350)finish(null,best);
      };
      const onError=async error=>{
        if(done)return;
        lastError=error;
        if(error?.code!==1)return;
        cached=null;best=null;
        if(permissionRecovery){finish(denied('O serviço de localização recusou a leitura, embora o site esteja autorizado. Reabra o aplicativo diretamente no Safari ou Chrome e tente atualizar a localização.','device'));return;}
        if(permissionChecked)return;
        permissionChecked=true;
        const state=await permissionState();
        if(done)return;
        if((state==='granted'||state==='prompt')&&geolocation.getCurrentPosition){
          permissionRecovery=true;
          if(watchId!==undefined)geolocation.clearWatch?.(watchId);
          try{geolocation.getCurrentPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:0,timeout});}catch(error){finish(error);}
        }else finish(denied('O acesso à localização deste aplicativo foi negado. Confira a permissão deste site e do Safari ou Chrome nas configurações do aparelho.','permission'));
      };
      const hardTimer=setTimeout(()=>{if(valid(best))finish(null,best);else finish(lastError||new Error('Não foi possível obter localização precisa. Tente atualizar a localização com o aplicativo aberto.'));},timeout);
      const settleTimer=setTimeout(()=>{settledEnough=true;if(valid(best)&&best.coords.accuracy<=350)finish(null,best);},settleDelay);
      const fallbackTimer=setTimeout(()=>{
        if(!done&&!permissionRecovery&&!permissionChecked){try{geolocation.getCurrentPosition(onPosition,onError,{enableHighAccuracy:false,timeout:Math.max(1000,timeout-fallbackDelay),maximumAge:0});}catch(error){onError(error);}}
      },fallbackDelay);
      try{const config={enableHighAccuracy:true,timeout,maximumAge:0};if(geolocation.watchPosition){watchId=geolocation.watchPosition(onPosition,onError,config);if(done)geolocation.clearWatch?.(watchId);}else geolocation.getCurrentPosition(onPosition,onError,config);}catch(error){finish(error);}
    }).finally(()=>{pending=null;});
    return pending;
  };
  read.invalidate=()=>{cached=null;};
  return read;
}
