/* industry-chains.js —— 产业链静态定义（无新接口，成分股行情复用统一行情源）
   全部成分股代码已用腾讯行情源逐一实测（2026-08），价格非 0、名称匹配，无编造代码。
   symbol 用腾讯格式：A股 sh/sz+6位、港股 hk+5位、美股 us+代码（全部经腾讯源逐一实测，2026-09-07/08）。
   全球视野：每条链在核心环节混入港股/美股龙头，与 A 股成分同权重参与环节强度计算。
   环节强度 = 环节内成分股涨跌幅简单平均。
   ⚠ 数据截止：链条定义与成分股名单为人工维护（2026-08 实测），
   新题材/成分股变更后需人工更新，不随行情自动刷新。 */

const INDUSTRY_CHAINS = [
  {
    id: 'nev', name: '新能源车',
    links: [
      { name: '锂矿资源', desc: '链条最上游：挖锂、镍、稀土等原材料，价格随金属行情大幅波动，是景气度的温度计。', stocks: [
        { name: '赣锋锂业', symbol: 'sz002460' },
        { name: '天齐锂业', symbol: 'sz002466' },
        { name: '北方稀土', symbol: 'sh600111' },
        { name: '紫金矿业', symbol: 'sh601899' },
      ]},
      { name: '电池材料', desc: '把矿物变成正极/负极/电解液/隔膜，技术门槛与毛利率的博弈都在这一环。', stocks: [
        { name: '天赐材料', symbol: 'sz002709' },
        { name: '当升科技', symbol: 'sz300073' },
        { name: '璞泰来', symbol: 'sh603659' },
        { name: '恩捷股份', symbol: 'sz002812' },
      ]},
      { name: '电池电芯', desc: '把材料组装成电池，规模与良率定胜负，宁德时代是全球龙头。', stocks: [
        { name: '宁德时代', symbol: 'sz300750' },
        { name: '亿纬锂能', symbol: 'sz300014' },
        { name: '国轩高科', symbol: 'sz002074' },
        { name: '欣旺达', symbol: 'sz300207' },
        { name: '孚能科技', symbol: 'sh688567' },
      ]},
      { name: '整车制造', desc: '面向消费者的终端，拼品牌、车型周期与价格战承受力。', stocks: [
        { name: '比亚迪', symbol: 'sz002594' },
        { name: '长城汽车', symbol: 'sh601633' },
        { name: '上汽集团', symbol: 'sh600104' },
        { name: '特斯拉', symbol: 'usTSLA', g: 'US' },
        { name: '蔚来', symbol: 'usNIO', g: 'US' },
        { name: '理想汽车', symbol: 'usLI', g: 'US' },
      ]},
      { name: '充电桩', desc: '电动化的基础设施，跟随保有量增长，商业模式还在探索。', stocks: [
        { name: '特锐德', symbol: 'sz300001' },
        { name: '科士达', symbol: 'sz002518' },
        { name: '国电南瑞', symbol: 'sh600406' },
        { name: '时代电气', symbol: 'sh688187' },
        { name: 'ChargePoint', symbol: 'usCHPT', g: 'US' },
      ]},
    ],
  },
  {
    id: 'semicon', name: '半导体',
    links: [
      { name: '设备', desc: '造芯片的机器（光刻/刻蚀/薄膜），国产替代的主战场，订单周期先行。', stocks: [
        { name: '北方华创', symbol: 'sz002371' },
        { name: '中微公司', symbol: 'sh688012' },
        { name: '盛美上海', symbol: 'sh688082' },
        { name: '长川科技', symbol: 'sz300604' },
        { name: '阿斯麦', symbol: 'usASML', g: 'US' },
        { name: '应用材料', symbol: 'usAMAT', g: 'US' },
      ]},
      { name: '材料', desc: '硅片、光刻胶、特气等耗材，客户认证周期长，粘性强。', stocks: [
        { name: '沪硅产业', symbol: 'sh688126' },
        { name: '立昂微', symbol: 'sh605358' },
        { name: '雅克科技', symbol: 'sz002409' },
        { name: '鼎龙股份', symbol: 'sz300054' },
      ]},
      { name: '设计', desc: '画芯片图纸的轻资产环节，人力与专利密集，对景气最敏感。', stocks: [
        { name: '兆易创新', symbol: 'sh603986' },
        { name: '澜起科技', symbol: 'sh688008' },
        { name: '圣邦股份', symbol: 'sz300661' },
        { name: '紫光国微', symbol: 'sz002049' },
        { name: '芯原股份', symbol: 'sh688521' },
        { name: '英伟达', symbol: 'usNVDA', g: 'US' },
        { name: '超威半导体', symbol: 'usAMD', g: 'US' },
        { name: '高通', symbol: 'usQCOM', g: 'US' },
      ]},
      { name: '制造', desc: '把图纸变成实体芯片的重资产环节，产能利用率决定盈利。', stocks: [
        { name: '士兰微', symbol: 'sh600460' },
        { name: '三安光电', symbol: 'sh600703' },
        { name: '豪威集团', symbol: 'sh603501' },
        { name: '台积电', symbol: 'usTSM', g: 'US' },
        { name: '英特尔', symbol: 'usINTC', g: 'US' },
      ]},
      { name: '封测', desc: '芯片的"后道工序"：封装与测试，技术壁垒相对低但现金流稳定。', stocks: [
        { name: '长电科技', symbol: 'sh600584' },
        { name: '通富微电', symbol: 'sz002156' },
        { name: '华天科技', symbol: 'sz002185' },
      ]},
    ],
  },
  {
    id: 'ai', name: 'AI 算力',
    links: [
      { name: '算力芯片', desc: 'AI 的大脑（GPU/ASIC），全球看英伟达，国内看国产替代。', stocks: [
        { name: '海光信息', symbol: 'sh688041' },
        { name: '中科曙光', symbol: 'sh603019' },
        { name: '寒武纪', symbol: 'sh688256' },
        { name: '英伟达', symbol: 'usNVDA', g: 'US' },
        { name: '超威半导体', symbol: 'usAMD', g: 'US' },
        { name: '博通', symbol: 'usAVGO', g: 'US' },
      ]},
      { name: '服务器', desc: '把芯片组装成算力单元，跟随云厂商与智算中心资本开支。', stocks: [
        { name: '浪潮信息', symbol: 'sz000977' },
        { name: '工业富联', symbol: 'sh601138' },
        { name: '中兴通讯', symbol: 'sz000063' },
      ]},
      { name: '光模块', desc: '数据中心内部与之间的"神经"，AI 集群放量最直接受益的环节之一。', stocks: [
        { name: '中际旭创', symbol: 'sz300308' },
        { name: '天孚通信', symbol: 'sz300394' },
        { name: '光迅科技', symbol: 'sz002281' },
        { name: '源杰科技', symbol: 'sh688498' },
        { name: '中天科技', symbol: 'sh600522' },
      ]},
      { name: '模型与平台', desc: '训练与运营大模型的公司，烧钱换生态，商业化仍在验证期。', stocks: [
        { name: '科大讯飞', symbol: 'sz002230' },
        { name: '昆仑万维', symbol: 'sz300418' },
        { name: '三六零', symbol: 'sh601360' },
        { name: '拓尔思', symbol: 'sz300229' },
        { name: '微软', symbol: 'usMSFT', g: 'US' },
        { name: 'Meta', symbol: 'usMETA', g: 'US' },
      ]},
      { name: '应用落地', desc: '把 AI 变成办公/金融/行业软件里的具体功能，离收入最近的一环。', stocks: [
        { name: '金山办公', symbol: 'sh688111' },
        { name: '恒生电子', symbol: 'sh600570' },
        { name: '中科创达', symbol: 'sz300496' },
        { name: '用友网络', symbol: 'sh600588' },
        { name: '万兴科技', symbol: 'sz300624' },
        { name: 'Palantir', symbol: 'usPLTR', g: 'US' },
      ]},
    ],
  },
  {
    id: 'pv', name: '光伏',
    links: [
      { name: '硅料', desc: '光伏最上游的多晶硅，周期性最强：暴利与过剩轮流上演。', stocks: [
        { name: '通威股份', symbol: 'sh600438' },
        { name: '大全能源', symbol: 'sh688303' },
        { name: '合盛硅业', symbol: 'sh603260' },
      ]},
      { name: '硅片', desc: '把硅料切成薄片，尺寸（大尺寸化）与薄片化是降本主线。', stocks: [
        { name: '隆基绿能', symbol: 'sh601012' },
        { name: 'TCL中环', symbol: 'sz002129' },
        { name: '协鑫集成', symbol: 'sz002506' },
      ]},
      { name: '电池片', desc: '决定光电转换效率的核心工序，N 型技术迭代的主战场。', stocks: [
        { name: '爱旭股份', symbol: 'sh600732' },
        { name: '钧达股份', symbol: 'sz002865' },
        { name: '东方日升', symbol: 'sz300118' },
      ]},
      { name: '组件', desc: '面向电站与家庭的最终产品，品牌与渠道构成差异化。', stocks: [
        { name: '天合光能', symbol: 'sh688599' },
        { name: '晶澳科技', symbol: 'sz002459' },
        { name: '阿特斯', symbol: 'sh688472' },
        { name: '第一太阳能', symbol: 'usFSLR', g: 'US' },
      ]},
      { name: '逆变器与支架', desc: '电站的"神经系统"与骨架，出口占比高，跟随全球装机。', stocks: [
        { name: '阳光电源', symbol: 'sz300274' },
        { name: '锦浪科技', symbol: 'sz300763' },
        { name: '固德威', symbol: 'sh688390' },
        { name: '德业股份', symbol: 'sh605117' },
        { name: '中信博', symbol: 'sh688408' },
        { name: 'Enphase', symbol: 'usENPH', g: 'US' },
        { name: 'SolarEdge', symbol: 'usSEDG', g: 'US' },
      ]},
    ],
  },
  {
    id: 'consumer', name: '消费电子',
    links: [
      { name: '芯片与SoC', desc: '手机/终端的大脑与芯片，国产替代与 AI 终端是主线。', stocks: [
        { name: '卓胜微', symbol: 'sz300782' },
        { name: '兆易创新', symbol: 'sh603986' },
        { name: '豪威集团', symbol: 'sh603501' },
        { name: '高通', symbol: 'usQCOM', g: 'US' },
      ]},
      { name: '面板', desc: '屏幕是终端最大的单个部件，京东方与TCL双寡头格局。', stocks: [
        { name: '京东方Ａ', symbol: 'sz000725' },
        { name: 'TCL科技', symbol: 'sz000100' },
        { name: '深天马Ａ', symbol: 'sz000050' },
      ]},
      { name: '光学', desc: '摄像头模组与镜片，拍照升级与车载光学双驱动。', stocks: [
        { name: '欧菲光', symbol: 'sz002456' },
        { name: '水晶光电', symbol: 'sz002273' },
        { name: '联创电子', symbol: 'sz002036' },
      ]},
      { name: '声学与零组件', desc: '声学、结构件、玻璃盖板等"看不见但离不开"的部分。', stocks: [
        { name: '立讯精密', symbol: 'sz002475' },
        { name: '歌尔股份', symbol: 'sz002241' },
        { name: '蓝思科技', symbol: 'sz300433' },
      ]},
      { name: '整机制造', desc: '代工组装（EMS），拼规模、良率与自动化，毛利率薄。', stocks: [
        { name: '工业富联', symbol: 'sh601138' },
        { name: '深科技', symbol: 'sz000021' },
        { name: '传音控股', symbol: 'sh688036' },
        { name: '苹果', symbol: 'usAAPL', g: 'US' },
        { name: '小米集团-W', symbol: 'hk01810', g: 'HK' },
      ]},
    ],
  },
  {
    id: 'pharma', name: '创新药',
    links: [
      { name: '原料药', desc: '药物活性成分，中国的传统优势出口品种，周期性与订单驱动。', stocks: [
        { name: '华海药业', symbol: 'sh600521' },
        { name: '普洛药业', symbol: 'sz000739' },
        { name: '健友股份', symbol: 'sh603707' },
      ]},
      { name: 'CXO', desc: '医药研发生产外包："卖水人"，新药研发越热它们越赚。', stocks: [
        { name: '药明康德', symbol: 'sh603259' },
        { name: '康龙化成', symbol: 'sz300759' },
        { name: '凯莱英', symbol: 'sz002821' },
      ]},
      { name: '创新药企', desc: '研发新药的公司，单个临床数据能决定百亿市值，高风险高弹性。', stocks: [
        { name: '恒瑞医药', symbol: 'sh600276' },
        { name: '百济神州', symbol: 'sh688235' },
        { name: '复星医药', symbol: 'sh600196' },
        { name: '中国生物制药', symbol: 'hk01177', g: 'HK' },
        { name: '辉瑞', symbol: 'usPFE', g: 'US' },
      ]},
      { name: '医疗器械', desc: '设备与耗材，集采（统一采购降价）是这些年最大的变量。', stocks: [
        { name: '迈瑞医疗', symbol: 'sz300760' },
        { name: '联影医疗', symbol: 'sh688271' },
        { name: '乐普医疗', symbol: 'sz300003' },
        { name: '强生', symbol: 'usJNJ', g: 'US' },
      ]},
      { name: '医疗服务', desc: '医院与检测服务，消费属性强，看客流与客单价。', stocks: [
        { name: '爱尔眼科', symbol: 'sz300015' },
        { name: '通策医疗', symbol: 'sh600763' },
        { name: '金域医学', symbol: 'sh603882' },
      ]},
    ],
  },
  {
    id: 'defense', name: '军工',
    links: [
      { name: '军工材料', desc: '钛合金、高温合金等特种材料，牌号认证壁垒极高。', stocks: [
        { name: '西部超导', symbol: 'sh688122' },
        { name: '抚顺特钢', symbol: 'sh600399' },
        { name: '钢研高纳', symbol: 'sz300034' },
      ]},
      { name: '元器件', desc: '连接器、电容等基础元件，"军工业的螺丝钉"，订单先行指标。', stocks: [
        { name: '中航光电', symbol: 'sz002179' },
        { name: '振华科技', symbol: 'sz000733' },
        { name: '宏达电子', symbol: 'sz300726' },
      ]},
      { name: '航空发动机', desc: '工业皇冠上的明珠，寿命到期的换发需求带来长周期确定性。', stocks: [
        { name: '航发动力', symbol: 'sh600893' },
        { name: '航发控制', symbol: 'sz000738' },
        { name: '应流股份', symbol: 'sh603308' },
      ]},
      { name: '飞机总装', desc: '战机与运输机整机厂，定价成本加成、业绩稳但弹性小。', stocks: [
        { name: '中航沈飞', symbol: 'sh600760' },
        { name: '中航西飞', symbol: 'sz000768' },
        { name: '洪都航空', symbol: 'sh600316' },
        { name: '洛克希德马丁', symbol: 'usLMT', g: 'US' },
        { name: '诺斯罗普格鲁曼', symbol: 'usNOC', g: 'US' },
      ]},
      { name: '军工信息化', desc: '通信、雷达与电子对抗，现代化装备中占比持续提升。', stocks: [
        { name: '海格通信', symbol: 'sz002465' },
        { name: '国睿科技', symbol: 'sh600562' },
        { name: '七一二', symbol: 'sh603712' },
      ]},
    ],
  },
  {
    id: 'robot', name: '机器人',
    links: [
      { name: '减速器', desc: '机器人的"关节"，精度决定一切，人形机器人放量的核心受益环节。', stocks: [
        { name: '绿的谐波', symbol: 'sh688017' },
        { name: '双环传动', symbol: 'sz002472' },
        { name: '中大力德', symbol: 'sz002896' },
      ]},
      { name: '伺服与电机', desc: '机器人的"肌肉"，空心杯电机/无框力矩电机是人形新需求。', stocks: [
        { name: '汇川技术', symbol: 'sz300124' },
        { name: '鸣志电器', symbol: 'sh603728' },
        { name: '步科股份', symbol: 'sh688160' },
      ]},
      { name: '控制器', desc: '机器人的"小脑"，运动控制算法与数控系统。', stocks: [
        { name: '华中数控', symbol: 'sz300161' },
        { name: '雷赛智能', symbol: 'sz002979' },
        { name: '埃斯顿', symbol: 'sz002747' },
      ]},
      { name: '传感器', desc: '视觉与力控传感，让机器人"看见"和"摸准"。', stocks: [
        { name: '奥比中光', symbol: 'sh688322' },
        { name: '柯力传感', symbol: 'sh603662' },
        { name: '汉威科技', symbol: 'sz300007' },
      ]},
      { name: '本体集成', desc: '整机厂，工业机器人看国产份额，人形看量产进度。', stocks: [
        { name: '机器人', symbol: 'sz300024' },
        { name: '拓斯达', symbol: 'sz300607' },
        { name: '埃斯顿', symbol: 'sz002747' },
      ]},
    ],
  },
  {
    id: 'storage', name: '储能',
    links: [
      { name: '储能电芯', desc: '与动力电池同源的技术，大容量电芯与循环寿命是竞争点。', stocks: [
        { name: '宁德时代', symbol: 'sz300750' },
        { name: '亿纬锂能', symbol: 'sz300014' },
        { name: '鹏辉能源', symbol: 'sz300438' },
        { name: '特斯拉', symbol: 'usTSLA', g: 'US' },
      ]},
      { name: '变流器PCS', desc: '储能系统的"心脏"，把直流交流互转，与光伏逆变器技术同源。', stocks: [
        { name: '阳光电源', symbol: 'sz300274' },
        { name: '科华数据', symbol: 'sz002335' },
        { name: '盛弘股份', symbol: 'sz300693' },
      ]},
      { name: '温控与消防', desc: '储能电站安全的生命线，液冷渗透率快速提升。', stocks: [
        { name: '英维克', symbol: 'sz002837' },
        { name: '申菱环境', symbol: 'sz301018' },
        { name: '高澜股份', symbol: 'sz300499' },
      ]},
      { name: '系统集成', desc: '把电芯/PCS/温控拼成可用电站，看项目获取与交付能力。', stocks: [
        { name: '派能科技', symbol: 'sh688063' },
        { name: '科陆电子', symbol: 'sz002121' },
        { name: '金盘科技', symbol: 'sh688676' },
        { name: 'Fluence', symbol: 'usFLNC', g: 'US' },
      ]},
    ],
  },
  {
    id: 'xinchuang', name: '信创',
    links: [
      { name: 'CPU与芯片', desc: '信创之根：国产处理器，性能与生态成熟度是两大指标。', stocks: [
        { name: '海光信息', symbol: 'sh688041' },
        { name: '龙芯中科', symbol: 'sh688047' },
        { name: '中国长城', symbol: 'sz000066' },
      ]},
      { name: '操作系统', desc: '麒麟/统信两强格局，装机量决定生态飞轮能否转起来。', stocks: [
        { name: '中国软件', symbol: 'sh600536' },
        { name: '诚迈科技', symbol: 'sz300598' },
        { name: '麒麟信安', symbol: 'sh688152' },
      ]},
      { name: '数据库中间件', desc: '数据基础设施的国产替代，金融/电信是先行行业。', stocks: [
        { name: '达梦数据', symbol: 'sh688692' },
        { name: '太极股份', symbol: 'sz002368' },
        { name: '宝兰德', symbol: 'sh688058' },
      ]},
      { name: '整机与云', desc: '信创服务器与云平台，跟随政府与央企采购节奏。', stocks: [
        { name: '紫光股份', symbol: 'sz000938' },
        { name: '浪潮信息', symbol: 'sz000977' },
        { name: '中科曙光', symbol: 'sh603019' },
      ]},
      { name: '行业应用', desc: '办公协同与ERP的国产化，粘性来自数据和流程迁移成本。', stocks: [
        { name: '泛微网络', symbol: 'sh603039' },
        { name: '用友网络', symbol: 'sh600588' },
        { name: '金山办公', symbol: 'sh688111' },
      ]},
    ],
  },
];

window.INDUSTRY_CHAINS = INDUSTRY_CHAINS;
