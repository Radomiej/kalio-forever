export function injectRaAppResizeBridge(rawHtml: string): string {
  const bridge = `\n<script>(function(){\n  const sendHeight=function(){\n    try{\n      const doc=document.documentElement;\n      const body=document.body;\n      const h=Math.max(\n        doc?doc.scrollHeight:0,\n        body?body.scrollHeight:0,\n        doc?doc.offsetHeight:0,\n        body?body.offsetHeight:0\n      );\n      parent.postMessage({type:'raapp_resize',height:h},'*');\n    }catch(e){console.error('[RAApp:Bridge] sendHeight failed',e);}\n  };\n  window.addEventListener('load',function(){sendHeight();setTimeout(sendHeight,80);setTimeout(sendHeight,300);});\n  window.addEventListener('resize',sendHeight);\n  window.addEventListener('message',function(event){\n    if(event&&event.data&&event.data.type==='raapp_query_height'){sendHeight();}\n  });\n  var ro=new ResizeObserver(function(){sendHeight();});\n  if(document&&document.documentElement){ro.observe(document.documentElement);}\n})();</script>\n`;
  const bodyClose = rawHtml.toLowerCase().lastIndexOf('</body>');
  if (bodyClose >= 0) {
    return `${rawHtml.slice(0, bodyClose)}${bridge}${rawHtml.slice(bodyClose)}`;
  }
  return `${rawHtml}${bridge}`;
}