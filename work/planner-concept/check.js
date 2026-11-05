
    (() => {
      const root = document.getElementById('sssb-concept');
      const data = JSON.parse(root.querySelector('#sc-observations').textContent);
      const get = s => root.querySelector(s);
      const config = { cardLayout:'Bredvid varandra', spread:true };
      let size = 18;
      let selectedMonth = '2026-09';
      const months = ['2026-06','2026-07','2026-08','2026-09'];
      const labels = ['Jun','Jul','Aug','Sep*'];
      const format = n => Math.round(n).toLocaleString('sv-SE');
      const floorMatches = d => get('#sc-floor').value === 'all' || d.floor >= (get('#sc-floor').value === 'above' ? 1 : 2);
      function render() {
        const days = Math.max(0, Math.min(4000, Number(get('#sc-days').value) || 0));
        const extra = Number(get('#sc-date').value);
        const personal = days + extra;
        root.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed',Number(b.dataset.size)===size));
        root.querySelector('.choices').style.gridTemplateColumns = config.cardLayout === 'Staplat' || root.clientWidth < 480 ? '1fr' : '1fr 1fr';
        for (const s of [18,23]) {
          const rents = data.filter(d=>d.size===s && floorMatches(d)).map(d=>d.rent);
          get('#sc-rent'+s).textContent = `${format(d3.min(rents))}–${format(d3.max(rents))} kr/mån`;
        }
        const chosen = data.filter(d=>d.size===size && floorMatches(d));
        const finished = chosen.filter(d=>d.days!==null);
        const stats = months.map((m,i) => {
          const obs = finished.filter(d=>d.month===m);
          const sorted = obs.map(d=>d.days).sort(d3.ascending);
          return { m, label:labels[i], n:obs.length, median:d3.median(sorted), q1:d3.quantileSorted(sorted,.25), q3:d3.quantileSorted(sorted,.75), good:obs.filter(d=>d.age>=0&&d.age<=300).length };
        });
        get('#sc-personal').textContent = `${format(personal)} ködagar ${extra ? 'vid vald tidpunkt' : 'idag'}`;
        get('#sc-coverage').textContent = `${new Set(chosen.map(d=>d.id)).size} unika bostäder · ${finished.length} avslutade annonser`;
        function details(s) {
          selectedMonth=s.m;
          get('#sc-detail').textContent = `${s.label.replace('*','')} 2026: ${format(s.median)} dagar i median · ${s.n} annonser · ${s.good} mätta inom 5 min före deadline`;
        }
        details(stats.find(s=>s.m===selectedMonth));
        const host = get('#sc-chart');
        const width = host.clientWidth;
        const height = 282;
        const margin={top:32,right:12,bottom:46,left:60};
        const top = Math.max(personal,...stats.map(s=>s.q3||0),1);
        const y=d3.scaleLinear().domain([0,top*1.16]).nice().range([height-margin.bottom,margin.top]);
        const x=d3.scaleBand().domain(months).range([margin.left,width-margin.right]).padding(.48);
        const svg=d3.select(host).selectAll('svg').data([null]).join('svg').attr('viewBox',`0 0 ${width} ${height}`).attr('role','img').attr('aria-label',`Historiska ködagar för ${size} kvadratmeter. ${stats.map(s=>`${s.label}: ${format(s.median)} dagar`).join('. ')}`);
        svg.selectAll('*').remove();
        svg.append('text').attr('x',margin.left).attr('y',16).text('Ködagar');
        const ticks=y.ticks(4);
        ticks.forEach(t=>{
          svg.append('line').attr('x1',margin.left).attr('x2',width-margin.right).attr('y1',y(t)).attr('y2',y(t)).attr('stroke','var(--line)');
          svg.append('text').attr('x',margin.left-8).attr('y',y(t)+4).attr('text-anchor','end').text(format(t));
        });
        stats.forEach(s=>{
          const mid=x(s.m)+x.bandwidth()/2;
          svg.append('rect').attr('x',x(s.m)).attr('y',y(s.median)).attr('width',x.bandwidth()).attr('height',y(0)-y(s.median)).attr('fill','var(--falu)').attr('opacity',s.m==='2026-09'?.55:.8);
          if(config.spread) {
            svg.append('line').attr('x1',mid).attr('x2',mid).attr('y1',y(s.q1)).attr('y2',y(s.q3)).attr('stroke','var(--ink)').attr('stroke-width',2);
            [s.q1,s.q3].forEach(q=>svg.append('line').attr('x1',mid-6).attr('x2',mid+6).attr('y1',y(q)).attr('y2',y(q)).attr('stroke','var(--ink)').attr('stroke-width',2));
          }
          svg.append('text').attr('x',mid).attr('y',y(config.spread?s.q3:s.median)-9).attr('text-anchor','middle').text(format(s.median));
          svg.append('text').attr('x',mid).attr('y',height-27).attr('text-anchor','middle').text(s.label);
          svg.append('text').attr('x',mid).attr('y',height-9).attr('text-anchor','middle').text(`n=${s.n}`);
          svg.append('rect').attr('x',mid-Math.max(44,x.step())/2).attr('y',margin.top).attr('width',Math.max(44,x.step())).attr('height',height-margin.top-margin.bottom).attr('fill','transparent').style('cursor','pointer').on('pointerenter',()=>details(s)).on('click',()=>details(s));
        });
        svg.append('line').attr('x1',margin.left).attr('x2',width-margin.right).attr('y1',y(personal)).attr('y2',y(personal)).attr('stroke','var(--green)').attr('stroke-width',2).attr('stroke-dasharray','6 4').attr('pointer-events','none');
      }
      root.querySelectorAll('[data-size]').forEach(b=>b.addEventListener('click',()=>{size=Number(b.dataset.size);render();}));
      ['#sc-days','#sc-floor','#sc-date'].forEach(s=>get(s).addEventListener('input',render));
      render();
      new ResizeObserver(render).observe(get('#sc-chart'));
      if (globalThis.Tweak) {
        const tweak = new Tweak({container:root,onChange:render});
        tweak.addSelect(config,'cardLayout',{label:'Bostadskort',options:['Bredvid varandra','Staplat']});
        tweak.addToggle(config,'spread',{label:'Visa historisk spridning'});
      }
    })();
  